import { parseArgs } from "node:util";

// Load .env (native Node — no dotenv dependency). Missing file is fine in CI.
try {
  process.loadEnvFile();
} catch {
  /* .env not present — rely on ambient env vars */
}

const USAGE = `Regulation Compliance Agent — pipeline stages as subcommands

Usage:
  npm run plan     [-- --pdf <file>] [--toc-pages <n>] [--out <file>]
  npm run cut      [-- --pdf <file>] [--plan <file>] [--out <file>]
  npm run extract  [-- --subset <file>] [--out <file>]
  npm run check    -- --input <file|-> [--rules <file>] [--out <file>]

Defaults target the committed FCA PS22/9 artifacts under data/.
`;

const [command] = process.argv.slice(2);
const rest = process.argv.slice(3);

switch (command) {
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
        plan: { type: "string", default: "data/extraction-plan.json" },
        out: { type: "string", default: "data/subset.md" },
        extra: { type: "string", multiple: true, default: [] },
      },
    });
    const { runCut } = await import("./commands/cut.js");
    await runCut({ pdf: values.pdf, plan: values.plan, out: values.out, extra: values.extra });
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
    console.error("check: designed after rules.json review — see DECISIONS.md D4");
    process.exit(1);
    break;
  }
  default:
    console.error(USAGE);
    process.exit(command ? 1 : 0);
}
