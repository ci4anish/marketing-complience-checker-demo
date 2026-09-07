import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { structuredCall, modelName } from "../llm.js";
import { RuleSet } from "../schemas.js";
import { EXTRACTOR_SYSTEM, extractorUser } from "../prompts.js";

export interface ExtractOptions {
  subset: string;
  out: string;
}

/**
 * Single-call guard: the scoped subset fits one context window, so extraction
 * runs as ONE call — the model sees all rules at once, dedupes across chapters
 * itself, and IDs stay stable. Documents larger than this threshold would need
 * the map-reduce path (per-section extraction + merge/dedup) described in
 * DECISIONS.md D8 — deliberately not built for this timeboxed POC.
 */
const MAX_SUBSET_WORDS = 60_000;

/**
 * Stage 3 — `extract`: one-time decomposition of the subset into discrete,
 * checkable rules (data/rules.json, committed). The compliance check consumes
 * this cache; re-run with `npm run extract` after changing the subset.
 */
export async function runExtract(opts: ExtractOptions): Promise<void> {
  const subset = await readFile(opts.subset, "utf8");

  const words = subset.split(/\s+/).length;
  if (words > MAX_SUBSET_WORDS) {
    throw new Error(
      `subset is ~${words} words (> ${MAX_SUBSET_WORDS}); single-call extraction not appropriate — see DECISIONS.md D8 (map-reduce extension)`,
    );
  }

  console.error(`extracting rules from ${opts.subset} (~${words} words) with ${modelName()}…`);

  const ruleSet = await structuredCall({
    schema: RuleSet,
    schemaName: "rule_set",
    system: EXTRACTOR_SYSTEM,
    user: extractorUser(subset),
  });

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(ruleSet, null, 2) + "\n");

  console.error(`\n${ruleSet.rules.length} rules written to ${opts.out}`);
  const byCategory = new Map<string, number>();
  for (const r of ruleSet.rules) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  for (const [cat, n] of byCategory) console.error(`  ${cat}: ${n}`);
  for (const r of ruleSet.rules) {
    console.error(`  [${r.id}] (${r.severity}) ${r.principle}`);
  }
}
