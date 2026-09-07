import { parseArgs } from "node:util";

// Load .env (native Node — no dotenv dependency). Missing file is fine in CI.
try {
  process.loadEnvFile();
} catch {
  /* .env not present — rely on ambient env vars */
}

const USAGE = `Regulation Compliance Agent — pipeline stages as subcommands

Usage:
  npm run scan     [-- --pdf <file>] [--window-size <n>] [--out <file>]
  npm run plan     [-- --pdf <file>] [--toc-pages <n>] [--out <file>]   (optional: section titles/overview)
  npm run cut      [-- --pdf <file>] [--scan <file>] [--out <file>]
  npm run extract  [-- --subset <file>] [--out <file>]
  npm run check    -- --input <file|-> [--rules <file>] [--out <file>]

Default flow: scan → cut → extract → check. Defaults target the committed
FCA PS22/9 artifacts under data/.
`;

const [command] = process.argv.slice(2);
const rest = process.argv.slice(3);

switch (command) {
  case "scan": {
    const { values } = parseArgs({
      args: rest,
      options: {
        pdf: { type: "string", default: "regulations.pdf" },
        "window-size": { type: "string", default: "12" },
        out: { type: "string", default: "data/scan.json" },
      },
    });
    const { runScan } = await import("./commands/scan.js");
    await runScan({
      pdf: values.pdf,
      windowSize: Number(values["window-size"]),
      out: values.out,
    });
    break;
  }
  case "plan": {
    const { values } = parseArgs({
      args: rest,
      options: {
        pdf: { type: "string", default: "regulations.pdf" },
        "toc-pages": { type: "string", default: "10" },
        out: { type: "string", default: "data/extraction-plan.json" },
      },
    });
    const { runPlan } = await import("./commands/plan.js");
    await runPlan({
      pdf: values.pdf,
      tocPages: Number(values["toc-pages"]),
      out: values.out,
    });
    break;
  }
  case "cut": {
    const { values } = parseArgs({
      args: rest,
      options: {
        pdf: { type: "string", default: "regulations.pdf" },
        scan: { type: "string", default: "data/scan.json" },
        out: { type: "string", default: "data/subset.md" },
        extra: { type: "string", multiple: true, default: [] },
      },
    });
    const { runCut } = await import("./commands/cut.js");
    await runCut({ pdf: values.pdf, scan: values.scan, out: values.out, extra: values.extra });
    break;
  }
  case "extract": {
    const { values } = parseArgs({
      args: rest,
      options: {
        subset: { type: "string", default: "data/subset.md" },
        out: { type: "string", default: "data/rules.json" },
      },
    });
    const { runExtract } = await import("./commands/extract.js");
    await runExtract({ subset: values.subset, out: values.out });
    break;
  }
  case "check": {
    const { values } = parseArgs({
      args: rest,
      options: {
        input: { type: "string" },
        rules: { type: "string", default: "data/rules.json" },
        out: { type: "string", default: "data/report.json" },
      },
    });
    if (!values.input) {
      console.error("check: --input <file|-> is required");
      process.exit(2);
    }
    try {
      const { runCheck } = await import("./commands/check.js");
      const report = await runCheck({ input: values.input, rules: values.rules, out: values.out });
      process.exitCode = report.band === "FAIL" ? 1 : 0; // CI-friendly (Q8)
    } catch (err) {
      console.error(`check: ${err instanceof Error ? err.message : err}`);
      process.exit(2);
    }
    break;
  }
  case "check:fixtures": {
    const { runCheckFixtures } = await import("./commands/check-fixtures.js");
    const ok = await runCheckFixtures();
    process.exitCode = ok ? 0 : 1;
    break;
  }
  case "eval:checker": {
    const { runCheckerEval } = await import("./commands/checker-eval.js");
    const ok = await runCheckerEval();
    process.exitCode = ok ? 0 : 1;
    break;
  }
  default:
    console.error(USAGE);
    process.exit(command ? 1 : 0);
}
