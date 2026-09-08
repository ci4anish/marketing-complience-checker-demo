import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractPdfPages, renderPageRange } from "../../core/pdf.js";
import { structuredCall } from "../../core/llm.js";
import { ExtractionPlan } from "./schemas.js";
import { PLANNER_SYSTEM, plannerUser } from "./prompts.js";

export interface PlanOptions {
  pdf: string;
  tocPages: number;
  out: string;
}

/**
 * Stage 1 — `plan`: the LLM reads the document's front matter (cover + TOC),
 * maps printed page numbers to PDF indices via the page markers, and decides
 * which sections contain obligations relevant to marketing-communications
 * compliance. Output: data/extraction-plan.json (every section listed, with a
 * reason — nothing silently dropped).
 */
export async function runPlan(opts: PlanOptions): Promise<void> {
  const { totalPages, pages } = await extractPdfPages(opts.pdf);
  const frontMatter = renderPageRange(pages, 1, Math.min(opts.tocPages, totalPages));

  console.error(`planning: ${opts.pdf} (${totalPages} pages), front matter = first ${opts.tocPages} pages`);

  const plan = await structuredCall({
    schema: ExtractionPlan,
    schemaName: "extraction_plan",
    system: PLANNER_SYSTEM,
    user: plannerUser(frontMatter, totalPages),
  });

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(plan, null, 2) + "\n");

  const relevant = plan.sections.filter((s) => s.relevant);
  console.error(`\nplan written to ${opts.out}`);
  console.error(`${plan.sections.length} sections found, ${relevant.length} relevant:`);
  for (const s of relevant) {
    console.error(`  ✔ p.${s.start_page}–${s.end_page}  ${s.title}`);
  }
}
