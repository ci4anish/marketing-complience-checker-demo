import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractPdfPages, renderPageRange } from "../../core/pdf.js";
import { structuredCall, modelName } from "../../core/llm.js";
import { WindowRules, RuleSet, type DraftRule } from "./schemas.js";
import { WINDOW_EXTRACTOR_SYSTEM, windowExtractorUser, DEDUPE_SYSTEM, dedupeUser } from "./prompts.js";

export interface ExtractMapReduceOptions {
  pdf: string;
  windowSize: number;
  out: string;
  /** Optional path for the pre-dedup draft rules — the map-step audit artifact. */
  raw?: string;
}

/**
 * Alternative extractor (DECISIONS.md D3 / D14 — the map-reduce path).
 *
 * Instead of scan → cut → extract, this fuses scan+extract into ONE call per
 * page-window (MAP), then merges the drafts with a single LLM dedupe pass
 * (REDUCE). What it trades vs the default pipeline:
 *   + page-level recall is structural — every page is extracted from, so a
 *     scan false-negative can't silently drop a rule;
 *   + no subset-fits-context ceiling (scales to larger documents);
 *   − the dedupe merges paraphrases WITHOUT seeing the source text (ungrounded),
 *     risking over-merge (lost rule) / under-merge (duplicate verdict);
 *   − no data/subset.md audit seam.
 * Kept as a second strategy so it can be A/B-scored against scan→cut→extract on
 * the golden set (point `check`/eval at its --out, or overwrite data/rules.json).
 */
export async function runExtractMapReduce(opts: ExtractMapReduceOptions): Promise<void> {
  const { totalPages, pages } = await extractPdfPages(opts.pdf);
  const step = Math.max(1, opts.windowSize - 1); // 1-page overlap, as scan

  const windows: Array<{ from: number; to: number }> = [];
  for (let from = 1; from <= totalPages; from += step) {
    windows.push({ from, to: Math.min(from + opts.windowSize - 1, totalPages) });
    if (from + opts.windowSize - 1 >= totalPages) break;
  }

  console.error(
    `map-reduce extract ${opts.pdf}: ${totalPages} pages in ${windows.length} windows of ${opts.windowSize} with ${modelName()}…`,
  );

  // --- MAP: fused scan+extract, one call per window, in parallel. ---
  const perWindow = await Promise.all(
    windows.map(async (w) => {
      const res = await structuredCall({
        schema: WindowRules,
        schemaName: "window_rules",
        system: WINDOW_EXTRACTOR_SYSTEM,
        user: windowExtractorUser(renderPageRange(pages, w.from, w.to)),
      });
      console.error(`  window p.${w.from}–${w.to}: ${res.rules.length} draft rules`);
      return res.rules;
    }),
  );
  const draftRules: DraftRule[] = perWindow.flat();
  console.error(`\nMAP done: ${draftRules.length} draft rules from ${windows.length} windows`);

  if (opts.raw) {
    await mkdir(dirname(opts.raw), { recursive: true });
    await writeFile(opts.raw, JSON.stringify({ draft_rules: draftRules }, null, 2) + "\n");
    console.error(`draft rules → ${opts.raw}`);
  }

  if (draftRules.length === 0) throw new Error("map step produced no rules — nothing to dedupe");

  // --- REDUCE: one dedupe/merge pass into the final rulebook. ---
  console.error(`\nREDUCE: merging ${draftRules.length} draft rules with ${modelName()}…`);
  const ruleSet = await structuredCall({
    schema: RuleSet,
    schemaName: "rule_set",
    system: DEDUPE_SYSTEM,
    user: dedupeUser(JSON.stringify(draftRules, null, 1)),
  });

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(ruleSet, null, 2) + "\n");

  console.error(`\n${draftRules.length} draft → ${ruleSet.rules.length} deduped rules written to ${opts.out}`);
  const byCategory = new Map<string, number>();
  for (const r of ruleSet.rules) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  for (const [cat, n] of byCategory) console.error(`  ${cat}: ${n}`);
  for (const r of ruleSet.rules) console.error(`  [${r.id}] (${r.severity}) ${r.principle}`);
}
