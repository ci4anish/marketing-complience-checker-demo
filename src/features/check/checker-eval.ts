import { readFile } from "node:fs/promises";
import { runCheck, type Band, type CheckReport } from "./check.js";

/**
 * Scorer for evaluations/checker-eval — 24 golden cases, ID-FREE (see DECISIONS D16).
 * Anchors to the band + verbatim fixture PHRASES, never rule IDs (which drift when
 * `extract` re-runs). A phrase is "caught" if some verdict quotes it in its evidence.
 * Scoring:
 *   HARD (gate): band match
 *              · every must_catch phrase quoted by some non_compliant verdict
 *              · no forbid_flag phrase quoted by any non_compliant verdict
 *              · no dishonest evidence (a quote not present in the input)
 *   DIAGNOSTIC:  ≥1 expect_needs_review phrase quoted by a needs_review verdict
 */

interface CaseExpectation {
  band: Band;
  must_catch?: string[];
  expect_needs_review?: string[];
  forbid_flag?: string[];
  scenario?: string;
}

const CONCURRENCY = 6;

/** Same normalization the check stage uses for its evidence substring test. */
const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

interface CaseScore {
  name: string;
  band: { expected: Band; got: Band; ok: boolean };
  mustCatchMissing: string[];
  forbidViolations: string[];
  evidenceUnverified: string[];
  needsReviewOk: boolean | null; // null = not asserted
  hardOk: boolean;
}

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
  // Evidence text grouped by verdict kind (only quotes that are real strings).
  const evidenceOf = (kind: string) =>
    r.verdicts
      .filter((v) => v.verdict === kind && typeof v.evidence === "string")
      .map((v) => norm(v.evidence as string));
  const ncEvidence = evidenceOf("non_compliant");
  const nrEvidence = evidenceOf("needs_review");

  const caught = (phrase: string, haystacks: string[]) => haystacks.some((e) => e.includes(norm(phrase)));

  const mustCatchMissing = (exp.must_catch ?? []).filter((p) => !caught(p, ncEvidence));
  const forbidViolations = (exp.forbid_flag ?? []).filter((p) => caught(p, ncEvidence));
  const evidenceUnverified = r.verdicts.filter((v) => v.evidence_verified === false).map((v) => v.rule_id);

  const nr = exp.expect_needs_review ?? [];
  const needsReviewOk = nr.length === 0 ? null : nr.some((p) => caught(p, nrEvidence));

  const bandOk = r.band === exp.band;
  return {
    name,
    band: { expected: exp.band, got: r.band, ok: bandOk },
    mustCatchMissing,
    forbidViolations,
    evidenceUnverified,
    needsReviewOk,
    hardOk: bandOk && mustCatchMissing.length === 0 && forbidViolations.length === 0 && evidenceUnverified.length === 0,
  };
}

function printCase(s: CaseScore): void {
  const hard = s.hardOk ? "✅" : "❌";
  const parts: string[] = [];
  if (!s.band.ok) parts.push(`band ${s.band.expected}→got ${s.band.got}`);
  if (s.mustCatchMissing.length) parts.push(`not caught: ${s.mustCatchMissing.map((p) => `"${p}"`).join(", ")}`);
  if (s.forbidViolations.length) parts.push(`⚠ false-positive: ${s.forbidViolations.map((p) => `"${p}"`).join(", ")}`);
  if (s.evidenceUnverified.length) parts.push(`dishonest evidence: ${s.evidenceUnverified.join(",")}`);
  if (s.needsReviewOk === false) parts.push("⚠ expected needs_review not raised");
  console.log(`${hard} ${s.name.padEnd(36)} ${s.band.got.padEnd(4)}${parts.length ? "  — " + parts.join("; ") : ""}`);
}

function printSummary(scores: CaseScore[]): boolean {
  const hardPass = scores.filter((s) => s.hardOk).length;
  const bandPass = scores.filter((s) => s.band.ok).length;
  const fpCases = scores.filter((s) => s.forbidViolations.length > 0).length;
  const nrAsserted = scores.filter((s) => s.needsReviewOk !== null);
  const nrPass = nrAsserted.filter((s) => s.needsReviewOk === true).length;

  console.log(`\n━━━ SUMMARY ━━━`);
  console.log(`HARD  band + must_catch + no false-positive + honest evidence : ${hardPass}/${scores.length} cases`);
  console.log(`      bands alone                                            : ${bandPass}/${scores.length}`);
  console.log(`DIAG  false-positive cases (forbid_flag violated)            : ${fpCases}`);
  console.log(`      needs_review raised                                    : ${nrPass}/${nrAsserted.length} asserted cases`);

  return hardPass === scores.length;
}
