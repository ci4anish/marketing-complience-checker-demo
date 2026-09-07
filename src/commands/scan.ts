import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractPdfPages, renderPageRange } from "../pdf.js";
import { structuredCall, modelName } from "../llm.js";
import { WindowScan, type ScanResult } from "../schemas.js";
import { SCANNER_SYSTEM, scannerUser } from "../prompts.js";

export interface ScanOptions {
  pdf: string;
  windowSize: number;
  out: string;
}

/**
 * Stage 1b — `scan`: sweep EVERY page of the document in parallel windows and
 * let the LLM decide which pages hold checkable obligations. Recall guarantee
 * by construction: each page is contained in at least one window, so no page
 * is ever excluded by a human or by a TOC blind spot (DECISIONS.md D11).
 *
 * Windows overlap by one page so obligations straddling a boundary are seen
 * with context on both sides; the union of page sets makes overlap harmless.
 */
export async function runScan(opts: ScanOptions): Promise<void> {
  const { totalPages, pages } = await extractPdfPages(opts.pdf);
  const step = Math.max(1, opts.windowSize - 1); // 1-page overlap

  const windows: Array<{ from: number; to: number }> = [];
  for (let from = 1; from <= totalPages; from += step) {
    windows.push({ from, to: Math.min(from + opts.windowSize - 1, totalPages) });
    if (from + opts.windowSize - 1 >= totalPages) break;
  }

  console.error(
    `scanning ${opts.pdf}: ${totalPages} pages in ${windows.length} windows of ${opts.windowSize} (1-page overlap) with ${modelName()}…`,
  );

  const results = await Promise.all(
    windows.map(async (w) => {
      const scan = await structuredCall({
        schema: WindowScan,
        schemaName: "window_scan",
        system: SCANNER_SYSTEM,
        user: scannerUser(renderPageRange(pages, w.from, w.to)),
      });
      // Defensive: drop any page reference outside the window actually sent.
      const inWindow = scan.relevant_pages.filter((p) => p.page >= w.from && p.page <= w.to);
      console.error(`  window p.${w.from}–${w.to}: ${inWindow.length} relevant`);
      return inWindow;
    }),
  );

  // Union across windows (a page may be reported by two overlapping windows).
  const byPage = new Map<number, string>();
  for (const r of results.flat()) {
    if (!byPage.has(r.page)) byPage.set(r.page, r.reason);
  }
  const relevantPages = [...byPage.entries()]
    .map(([page, reason]) => ({ page, reason }))
    .sort((a, b) => a.page - b.page);

  // Collapse consecutive pages into ranges for cut.
  const ranges: Array<{ from: number; to: number }> = [];
  for (const { page } of relevantPages) {
    const last = ranges[ranges.length - 1];
    if (last && page === last.to + 1) last.to = page;
    else ranges.push({ from: page, to: page });
  }

  const result: ScanResult = {
    total_pages: totalPages,
    window_size: opts.windowSize,
    relevant_pages: relevantPages,
    ranges,
  };

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(result, null, 2) + "\n");

  console.error(`\nscan written to ${opts.out}`);
  console.error(
    `${relevantPages.length}/${totalPages} pages relevant, ${ranges.length} ranges: ` +
      ranges.map((r) => (r.from === r.to ? `p.${r.from}` : `p.${r.from}–${r.to}`)).join(", "),
  );
}
