// Structural validator for the checker-eval golden set. Does NOT call the LLM —
// it checks the dataset is internally sound and still mapped to the live ruleset.
//   node evaluations/checker-eval/validate.mjs
//
// Run this after every `npm run extract`: the extractor is non-deterministic, so
// rule IDs/taxonomy drift between runs and the pinned IDs here must be re-mapped
// when the fingerprint no longer matches.
import { readFileSync, readdirSync } from "node:fs";

const dir = "evaluations/checker-eval";
const exp = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8"));
const rs = JSON.parse(readFileSync("data/rules.json", "utf8"));

const valid = new Set(rs.rules.map((r) => r.id));
const sevOf = Object.fromEntries(rs.rules.map((r) => [r.id, r.severity]));
const files = new Set(readdirSync(`${dir}/cases`).filter((f) => f.endsWith(".txt")));
const cases = Object.keys(exp).filter((k) => !k.startsWith("_"));

const problems = [];
const bands = {};

// Fingerprint drift — the load-bearing check given a non-deterministic extractor.
const fp = exp._ruleset;
if (fp?.rule_count !== rs.rules.length) {
  problems.push(
    `FINGERPRINT DRIFT: expected ${fp?.rule_count} rules, live rules.json has ${rs.rules.length}. ` +
      `Re-map rule IDs in expected.json (see README "ID drift").`,
  );
}

for (const c of cases) {
  const e = exp[c];
  if (!files.has(c)) problems.push(`${c}: no matching fixture in cases/`);
  bands[e.band] = (bands[e.band] || 0) + 1;

  for (const field of ["must_flag", "must_not_flag", "expect_needs_review", "expect_not_applicable"]) {
    for (const id of e[field] || []) {
      if (!valid.has(id)) problems.push(`${c}: ${field} references unknown rule ${id}`);
    }
  }

  // Band ↔ severity self-consistency (mirrors src/commands/check.ts band policy).
  const flags = e.must_flag || [];
  if (e.band === "FAIL" && flags.length && !flags.some((id) => sevOf[id] === "high"))
    problems.push(`${c}: band FAIL but must_flag has no HIGH-severity rule`);
  if (e.band === "WARN" && flags.some((id) => sevOf[id] === "high"))
    problems.push(`${c}: band WARN but must_flag contains a HIGH-severity rule`);
  if (e.band === "PASS" && flags.length) problems.push(`${c}: band PASS but must_flag is non-empty`);

  // A rule can't be both required-to-flag and required-not-to-flag.
  const overlap = (e.must_flag || []).filter((id) => (e.must_not_flag || []).includes(id));
  if (overlap.length) problems.push(`${c}: ${overlap.join(", ")} in both must_flag and must_not_flag`);
}

for (const f of files) if (!exp[f]) problems.push(`${f}: fixture has no expectation entry`);

console.log(`cases: ${cases.length} | fixtures: ${files.size} | bands: ${JSON.stringify(bands)}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n` + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
console.log("✓ dataset valid: fingerprint matches, all IDs exist, band/severity consistent, fixture parity");
