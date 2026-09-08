import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { structuredCall, modelName } from "../../core/llm.js";
import { CheckOutput, RuleSet, type Rule, type Verdict } from "./schemas.js";
import { CHECKER_SYSTEM, checkerUser } from "./prompts.js";

export interface CheckOptions {
  input: string; // path or "-" for stdin
  rules: string;
  out: string;
  /** Suppress the terminal digest (used by batch eval runners). */
  quiet?: boolean;
}

export type Band = "PASS" | "WARN" | "FAIL";

export interface CheckReport {
  band: Band;
  counts: {
    non_compliant_high: number;
    non_compliant_medium: number;
    non_compliant_low: number;
    needs_review: number;
    compliant: number;
    not_applicable: number;
  };
  summary: string;
  verdicts: Array<Verdict & { severity: Rule["severity"]; principle: string; evidence_verified: boolean | null }>;
  input_text: string;
  rules_file: string;
  model: string;
}

/** Normalize for the evidence substring check: whitespace, quotes, dashes, case. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function readInput(input: string): Promise<string> {
  if (input === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(input, "utf8");
}

/**
 * Stage 4 — `check`: evaluate an input text rule-by-rule against the cached
 * ruleset. LLM judges per rule; CODE owns the guarantees:
 *   - completeness: exactly one verdict per rule ID (hard error otherwise);
 *   - evidence honesty: quoted evidence must be a real substring of the input;
 *   - the overall PASS/WARN/FAIL band (no model-invented policy).
 */
export async function runCheck(opts: CheckOptions): Promise<CheckReport> {
  const ruleSet = RuleSet.parse(JSON.parse(await readFile(opts.rules, "utf8")));
  const inputText = (await readInput(opts.input)).trim();
  if (!inputText) throw new Error("input text is empty");

  if (!opts.quiet)
    console.error(`checking input (${inputText.length} chars) against ${ruleSet.rules.length} rules with ${modelName()}…`);

  const output = await structuredCall({
    schema: CheckOutput,
    schemaName: "check_output",
    system: CHECKER_SYSTEM,
    user: checkerUser(JSON.stringify(ruleSet.rules, null, 1), inputText),
  });

  // --- Completeness: exactly one verdict per rule, no extras (hard error). ---
  const ruleById = new Map(ruleSet.rules.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const v of output.verdicts) {
    if (!ruleById.has(v.rule_id)) throw new Error(`model returned verdict for unknown rule: ${v.rule_id}`);
    if (seen.has(v.rule_id)) throw new Error(`model returned duplicate verdict for rule: ${v.rule_id}`);
    seen.add(v.rule_id);
  }
  const missing = ruleSet.rules.filter((r) => !seen.has(r.id)).map((r) => r.id);
  if (missing.length > 0) throw new Error(`model returned no verdict for: ${missing.join(", ")}`);

  // --- Evidence honesty: quoted evidence must actually appear in the input. ---
  // The model may cite MULTIPLE fragments (a breach scattered across the text),
  // separated by newlines or ellipses — each fragment must be verbatim, so the
  // check verifies per-fragment. Wrapping quotation marks are stripped: we
  // verify the quoted TEXT exists, not its punctuation wrapper.
  const normInput = normalize(inputText);
  const stripWrappingQuotes = (s: string) => s.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "");
  const evidenceFragments = (e: string): string[] =>
    e
      .split(/\n+|…|\.\.\./)
      .map((f) => stripWrappingQuotes(f.trim()))
      .filter((f) => f.length > 0);
  const verdicts = output.verdicts.map((v) => {
    const rule = ruleById.get(v.rule_id)!;
    const evidence_verified =
      v.evidence === null
        ? null
        : evidenceFragments(v.evidence).every((f) => normInput.includes(normalize(f)));
    return { ...v, severity: rule.severity, principle: rule.principle, evidence_verified };
  });

  // --- Band: deterministic policy, computed here, never by the model (Q3). ---
  const nc = verdicts.filter((v) => v.verdict === "non_compliant");
  const counts = {
    non_compliant_high: nc.filter((v) => v.severity === "high").length,
    non_compliant_medium: nc.filter((v) => v.severity === "medium").length,
    non_compliant_low: nc.filter((v) => v.severity === "low").length,
    needs_review: verdicts.filter((v) => v.verdict === "needs_review").length,
    compliant: verdicts.filter((v) => v.verdict === "compliant").length,
    not_applicable: verdicts.filter((v) => v.verdict === "not_applicable").length,
  };
  const band: Band =
    counts.non_compliant_high > 0
      ? "FAIL"
      : counts.non_compliant_medium + counts.non_compliant_low + counts.needs_review > 0
        ? "WARN"
        : "PASS";

  const report: CheckReport = {
    band,
    counts,
    summary: output.summary,
    verdicts,
    input_text: inputText,
    rules_file: opts.rules,
    model: modelName(),
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(report, null, 2) + "\n");

  if (!opts.quiet) {
    renderDigest(report);
    console.error(`\nfull report → ${opts.out}`);
  }
  return report;
}

/** Terminal digest: breaches & reviews in detail; the rest collapsed (Q8). */
function renderDigest(r: CheckReport): void {
  const c = r.counts;
  console.log(
    `\nVERDICT: ${r.band} — ${c.non_compliant_high} high, ${c.non_compliant_medium} medium, ${c.non_compliant_low} low non-compliant · ` +
      `${c.needs_review} needs review · ${c.compliant} compliant · ${c.not_applicable} n/a\n`,
  );

  for (const v of r.verdicts.filter((v) => v.verdict === "non_compliant")) {
    console.log(`✗ ${v.severity.toUpperCase().padEnd(6)} ${v.rule_id.padEnd(6)} ${v.principle}`);
    if (v.evidence !== null) {
      const mark = v.evidence_verified ? "" : "  [!! evidence NOT found verbatim in input]";
      console.log(`         evidence: "${v.evidence}"${mark}`);
    } else {
      console.log(`         evidence: (breach by omission)`);
    }
    console.log(`         ${v.reasoning}\n`);
  }

  for (const v of r.verdicts.filter((v) => v.verdict === "needs_review")) {
    console.log(`? REVIEW ${v.rule_id.padEnd(6)} verify → ${v.fact_to_verify ?? "(fact not named)"}`);
    console.log(`         ${v.reasoning}\n`);
  }

  const ids = (kind: Verdict["verdict"]) =>
    r.verdicts.filter((v) => v.verdict === kind).map((v) => v.rule_id).join(", ") || "—";
  console.log(`✓ compliant (${c.compliant}): ${ids("compliant")}`);
  console.log(`– not applicable (${c.not_applicable}): ${ids("not_applicable")}`);
  console.log(`\n${r.summary}`);
}
