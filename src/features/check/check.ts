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

// ---------------------------------------------------------------------------
// Terminal digest — breaches & reviews in detail, the rest collapsed (Q8).
// Zero-dep ANSI styling: honours NO_COLOR and non-TTY output (pipes stay plain).
// ---------------------------------------------------------------------------

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1");
const dim = paint("2");
const red = paint("31;1");
const yellow = paint("33;1");
const green = paint("32;1");
const cyan = paint("36;1");
const BAND_STYLE: Record<Band, (s: string) => string> = {
  FAIL: paint("41;97;1"), // white on red
  WARN: paint("43;30;1"), // black on yellow
  PASS: paint("42;30;1"), // black on green
};
const SEVERITY_STYLE: Record<Rule["severity"], (s: string) => string> = {
  high: red,
  medium: yellow,
  low: paint("33"),
};

const WIDTH = Math.min(process.stdout.columns ?? 100, 100);

/** Visible length: ANSI escape codes don't take up columns. */
const visibleLen = (s: string): number => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Word-wrap `text` to WIDTH with a hanging indent. */
function wrap(text: string, indent: string, firstLinePrefix = indent): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = firstLinePrefix;
  for (const w of words) {
    const hasContent = visibleLen(line) > visibleLen(line.trimEnd() === "" ? line : indent) || !line.endsWith(" ");
    const sep = line.endsWith(" ") ? "" : " ";
    if (visibleLen(line) + sep.length + visibleLen(w) > WIDTH && hasContent) {
      lines.push(line);
      line = indent + w;
    } else {
      line += sep + w;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

export function renderDigest(r: CheckReport): void {
  const c = r.counts;
  const rule = dim("─".repeat(WIDTH));

  // Band banner + count strip (zero counts omitted — signal only).
  const breaches: string[] = [];
  if (c.non_compliant_high) breaches.push(red(`${c.non_compliant_high} high`));
  if (c.non_compliant_medium) breaches.push(yellow(`${c.non_compliant_medium} medium`));
  if (c.non_compliant_low) breaches.push(`${c.non_compliant_low} low`);
  const strip = [
    breaches.length ? `${breaches.join(", ")} ${breaches.length === 1 && c.non_compliant_high + c.non_compliant_medium + c.non_compliant_low === 1 ? "breach" : "breaches"}` : green("no breaches"),
    c.needs_review ? cyan(`${c.needs_review} to verify`) : null,
    `${c.compliant} compliant`,
    dim(`${c.not_applicable} n/a`),
  ].filter(Boolean);
  console.log(`\n${rule}`);
  console.log(`  ${BAND_STYLE[r.band](` ${r.band} `)}  ${strip.join(dim("  ·  "))}`);
  console.log(rule);

  // Findings: high → medium → low, then reviews.
  const order: Record<Rule["severity"], number> = { high: 0, medium: 1, low: 2 };
  const findings = r.verdicts
    .filter((v) => v.verdict === "non_compliant")
    .sort((a, b) => order[a.severity] - order[b.severity]);

  for (const v of findings) {
    const sev = SEVERITY_STYLE[v.severity](v.severity.toUpperCase());
    console.log(`\n  ${red("✗")} ${bold(v.rule_id)} ${sev}`);
    console.log(wrap(v.principle, "    "));
    if (v.evidence !== null) {
      const quote = v.evidence.replace(/\s*\n+\s*/g, " ⏎ ");
      const mark = v.evidence_verified ? "" : ` ${red("⚠ not verbatim in input")}`;
      console.log(wrap(dim(`“${quote}”`) + mark, "    "));
    } else {
      console.log(`    ${dim("(breach by omission — see reasoning)")}`);
    }
    console.log(dim(wrap(v.reasoning, "    ")));
  }

  for (const v of r.verdicts.filter((v) => v.verdict === "needs_review")) {
    console.log(`\n  ${cyan("?")} ${bold(v.rule_id)} ${cyan("VERIFY")}`);
    console.log(wrap(v.fact_to_verify ?? "(fact not named)", "    "));
    console.log(dim(wrap(v.reasoning, "    ")));
  }

  // Collapsed tails: IDs only.
  const ids = (kind: Verdict["verdict"]) =>
    r.verdicts.filter((v) => v.verdict === kind).map((v) => v.rule_id).join(" ") || "—";
  console.log();
  console.log(wrap(dim(`✓ compliant (${c.compliant})  ${ids("compliant")}`), "    ", "  "));
  console.log(wrap(dim(`– not applicable (${c.not_applicable})  ${ids("not_applicable")}`), "    ", "  "));

  // Model summary.
  console.log(`\n  ${bold("SUMMARY")}`);
  console.log(wrap(r.summary, "  "));
}
