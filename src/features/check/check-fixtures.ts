import { readFile } from "node:fs/promises";
import { runCheck, type Band } from "./check.js";

interface Expectation {
  band: Band;
  must_flag: string[];
  why: string;
}

/**
 * Smoke test for the whole check stage: run every fixture and diff the result
 * against evaluations/checker-eval/smoke/expected.json. Expectations pin bands
 * + a few must-flag rule IDs only (full verdict goldens would be brittle — see
 * the _note in expected.json). Exit non-zero on any mismatch.
 */
export async function runCheckFixtures(): Promise<boolean> {
  const dir = "evaluations/checker-eval/smoke";
  const expected = JSON.parse(await readFile(`${dir}/expected.json`, "utf8")) as Record<
    string,
    Expectation | string
  >;

  let allOk = true;
  for (const [fixture, exp] of Object.entries(expected)) {
    if (fixture.startsWith("_") || typeof exp === "string") continue;

    console.log(`\n━━━ fixture: ${fixture} (expect ${exp.band}) ━━━`);
    const report = await runCheck({
      input: `${dir}/${fixture}`,
      rules: "data/rules.json",
      out: `data/report.${fixture.replace(/\.txt$/, "")}.json`,
    });

    const problems: string[] = [];
    if (report.band !== exp.band) problems.push(`band: expected ${exp.band}, got ${report.band}`);
    const flagged = new Set(report.verdicts.filter((v) => v.verdict === "non_compliant").map((v) => v.rule_id));
    for (const id of exp.must_flag) {
      if (!flagged.has(id)) problems.push(`must-flag rule ${id} was not flagged non_compliant`);
    }
    const unverified = report.verdicts.filter((v) => v.evidence_verified === false).map((v) => v.rule_id);
    if (unverified.length > 0) problems.push(`unverified evidence quotes on: ${unverified.join(", ")}`);

    if (problems.length === 0) {
      console.log(`\n✅ ${fixture}: matches expectations`);
    } else {
      allOk = false;
      console.log(`\n❌ ${fixture}:`);
      for (const p of problems) console.log(`   - ${p}`);
    }
  }

  console.log(allOk ? "\nALL FIXTURES PASS" : "\nFIXTURE MISMATCHES — see above");
  return allOk;
}
