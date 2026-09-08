// Structural validator for the ID-FREE checker-eval golden set. No LLM, and —
// importantly — NO dependency on data/rules.json: this dataset references rule
// IDs nowhere, so it never drifts when `extract` re-runs.
//   node evaluations/checker-eval/validate.mjs
//
// It checks the dataset is internally sound and that every phrase we assert is
// actually present in its fixture (so no assertion is unsatisfiable).
import { readFileSync, readdirSync } from "node:fs";

const dir = "evaluations/checker-eval";
const exp = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8"));

// Same normalization the check stage uses for its evidence substring test.
const norm = (s) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

const cases = Object.keys(exp).filter((k) => !k.startsWith("_"));
const fixtures = new Set(readdirSync(`${dir}/cases`).filter((f) => f.endsWith(".txt")));
const problems = [];
const bands = {};

for (const c of cases) {
  const e = exp[c];
  if (!fixtures.has(c)) {
    problems.push(`${c}: no matching fixture in cases/`);
    continue;
  }
  bands[e.band] = (bands[e.band] || 0) + 1;
  if (!["PASS", "WARN", "FAIL"].includes(e.band)) problems.push(`${c}: invalid band ${e.band}`);

  const text = norm(readFileSync(`${dir}/cases/${c}`, "utf8"));
  const mustCatch = e.must_catch || [];
  const needsReview = e.expect_needs_review || [];
  const forbid = e.forbid_flag || [];

  // Every asserted phrase must actually occur in the fixture, else it's unsatisfiable.
  for (const [field, list] of [["must_catch", mustCatch], ["expect_needs_review", needsReview], ["forbid_flag", forbid]]) {
    for (const p of list) if (!text.includes(norm(p))) problems.push(`${c}: ${field} phrase not found in fixture: "${p}"`);
  }

  // A phrase can't be both required-to-flag and forbidden-to-flag.
  for (const p of mustCatch) if (forbid.includes(p)) problems.push(`${c}: "${p}" is in both must_catch and forbid_flag`);

  // Band ↔ assertion consistency (mirrors the band policy).
  if (e.band === "PASS" && (mustCatch.length || needsReview.length))
    problems.push(`${c}: band PASS but has must_catch/expect_needs_review (would force WARN/FAIL)`);
  if (e.band === "WARN" && !mustCatch.length && !needsReview.length && !e._band_driven)
    problems.push(`${c}: band WARN but nothing drives it off PASS (add a phrase, or set "_band_driven": true for aggregate defects)`);
  if (e.band === "FAIL" && !mustCatch.length && !e._band_driven)
    problems.push(`${c}: band FAIL but no must_catch phrase (add one, or set "_band_driven": true for omission-only breaches)`);
}

for (const f of fixtures) if (!exp[f]) problems.push(`${f}: fixture has no expectation entry`);

console.log(`cases: ${cases.length} | fixtures: ${fixtures.size} | bands: ${JSON.stringify(bands)}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n` + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
console.log("✓ ID-free dataset valid: all phrases present in fixtures, bands consistent, fixture parity");
