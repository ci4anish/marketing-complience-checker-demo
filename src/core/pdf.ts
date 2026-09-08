import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfPages {
  totalPages: number;
  /** Extracted text per page; pages[0] is PDF page 1. */
  pages: string[];
}

/** Extract per-page text from a PDF. Pure JS (pdfjs) — no system dependencies. */
export async function extractPdfPages(path: string): Promise<PdfPages> {
  const buffer = await readFile(path);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text };
}

/**
 * Render a 1-based inclusive page range with explicit PDF-page markers.
 * The markers let the LLM reference *PDF indices* (not the document's printed
 * page numbers, which are offset by cover/contents pages — see DECISIONS.md D5).
 */
export function renderPageRange(pages: string[], from: number, to: number): string {
  const chunks: string[] = [];
  for (let p = from; p <= Math.min(to, pages.length); p++) {
    chunks.push(`=== PDF PAGE ${p} ===\n${(pages[p - 1] ?? "").trim()}`);
  }
  return chunks.join("\n\n");
}
