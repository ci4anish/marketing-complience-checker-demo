import { readFile } from "node:fs/promises";
import { runCheck, type Band, type CheckReport } from "./check.js";

/**
 * Scorer for evaluations/checker-eval — 24 golden cases for the check stage.
 * Scoring semantics follow that dataset's README:
 *   HARD (gate):  band match · must_flag ⊆ non_compliant · no unverified evidence
 *   DIAGNOSTIC:   must_not_flag ∩ non_compliant = ∅ · ≥1 of expect_needs_review
 *                 is needs_review · expect_not_applicable scored as a proportion
 */

interface CaseExpectation {
  band: Band;
  must_flag: string[];
  must_not_flag: string[];
  expect_needs_review: string[];
  expect_not_applicable: string[];
  scenario?: string;
}

interface CaseScore {
  name: string;
  band: { expected: Band; got: Band; ok: boolean };
  mustFlagMissing: string[];
  evidenceUnverified: string[];
  hardOk: boolean;
  falsePositives: string[]; // must_not_flag that WERE flagged
  needsReviewOk: boolean | null; // null = not asserted
  naHit: number;
  naTotal: number;
}

const CONCURRENCY = 6;

export async function runCheckerEval(): Promise<boolean> {
  const dir = "evaluations/checker-eval";
  const expected = JSON.parse(await readFile(`${dir}/expected.json`, "utf8")) as Record<string, unknown>;
  const names = Object.keys(expected).filter((k) => k.endsWith(".txt"));

  console.error(`checker-eval: ${names.length} cases, concurrency ${CONCURRENCY}\n`);

  const scores: CaseScore[] = [];
  for (let i = 0; i < names.length; i += CONCURRENCY) {
    const batch = names.slice(i, i + CONCURRENCY);
    const reports = await Promise.all(
      batch.map(async (name) => {
        const report = await runCheck({
          input: `${dir}/cases/${name}`,
          rules: "data/rules.json",
          out: `data/checker-eval-reports/${name.replace(/\.txt$/, "")}.json`,
          quiet: true,
        });
        return { name, report };
      }),
    );
    for (const { name, report } of reports) {
      const score = scoreCase(name, expected[name] as CaseExpectation, report);
      scores.push(score);
      printCase(score);
    }
  }

  return printSummary(scores);
}

function scoreCase(name: string, exp: CaseExpectation, r: CheckReport): CaseScore {
  const byId = new Map(r.verdicts.map((v) => [v.rule_id, v]));
  const flagged = new Set(r.verdicts.filter((v) => v.verdict === "non_compliant").map((v) => v.rule_id));

  const mustFlagMissing = exp.must_flag.filter((id) => !flagged.has(id));
  const evidenceUnverified = r.verdicts.filter((v) => v.evidence_verified === false).map((v) => v.rule_id);
  const bandOk = r.band === exp.band;

  const falsePositives = (exp.must_not_flag ?? []).filter((id) => flagged.has(id));
  const nr = exp.expect_needs_review ?? [];
  const needsReviewOk = nr.length === 0 ? null : nr.some((id) => byId.get(id)?.verdict === "needs_review");
  const na = exp.expect_not_applicable ?? [];
  const naHit = na.filter((id) => byId.get(id)?.verdict === "not_applicable").length;

  return {
    name,
    band: { expected: exp.band, got: r.band, ok: bandOk },
    mustFlagMissing,
    evidenceUnverified,
    hardOk: bandOk && mustFlagMissing.length === 0 && evidenceUnverified.length === 0,
    falsePositives,
    needsReviewOk,
    naHit,
    naTotal: na.length,
  };
}

function printCase(s: CaseScore): void {
  const hard = s.hardOk ? "✅" : "❌";
  const parts: string[] = [];
  if (!s.band.ok) parts.push(`band ${s.band.expected}→got ${s.band.got}`);
  if (s.mustFlagMissing.length) parts.push(`must_flag missed: ${s.mustFlagMissing.join(",")}`);
  if (s.evidenceUnverified.length) parts.push(`unverified evidence: ${s.evidenceUnverified.join(",")}`);
  if (s.falsePositives.length) parts.push(`⚠ false-positive: ${s.falsePositives.join(",")}`);
  if (s.needsReviewOk === false) parts.push("⚠ expected needs_review not raised");
  const na = s.naTotal ? ` n/a ${s.naHit}/${s.naTotal}` : "";
  console.log(`${hard} ${s.name.padEnd(36)} ${s.band.got.padEnd(4)}${na}${parts.length ? "  — " + parts.join("; ") : ""}`);
}

function printSummary(scores: CaseScore[]): boolean {
  const hardPass = scores.filter((s) => s.hardOk).length;
  const bandPass = scores.filter((s) => s.band.ok).length;
  const fpCases = scores.filter((s) => s.falsePositives.length > 0).length;
  const nrAsserted = scores.filter((s) => s.needsReviewOk !== null);
  const nrPass = nrAsserted.filter((s) => s.needsReviewOk === true).length;
  const naHit = scores.reduce((a, s) => a + s.naHit, 0);
  const naTotal = scores.reduce((a, s) => a + s.naTotal, 0);

  console.log(`\n━━━ SUMMARY ━━━`);
  console.log(`HARD  band+must_flag+evidence : ${hardPass}/${scores.length} cases`);
  console.log(`      bands alone             : ${bandPass}/${scores.length}`);
  console.log(`DIAG  false-positive cases    : ${fpCases} (must_not_flag violations)`);
  console.log(`      needs_review raised     : ${nrPass}/${nrAsserted.length} asserted cases`);
  console.log(`      not_applicable hit rate : ${naHit}/${naTotal} (${naTotal ? Math.round((100 * naHit) / naTotal) : 0}%)`);

  return hardPass === scores.length;
}
