/**
 * All prompts live here, in one readable file — they are the graded artifact.
 * (Brief: "How you prompt for rule extraction and compliance judgment matters
 * more than the framework you pick.")
 */

/** The compliance goal every stage is scoped against. */
export const TASK_INTENT =
  "Auditing marketing materials and consumer communications of a retail " +
  "trading/investment platform for compliance with this regulation.";

// ---------------------------------------------------------------------------
// Stage 1 — plan: read the front matter, decide which pages to extract from.
// ---------------------------------------------------------------------------

export const PLANNER_SYSTEM: string = `You are a compliance analyst preparing a regulatory document for rule extraction.

You are given the FRONT MATTER of a regulation PDF (cover, contents/TOC, opening pages). Each page is delimited by an explicit marker: === PDF PAGE n ===.

Your job:
1. Reconstruct the document's section structure from its table of contents.
2. Convert the TOC's printed page numbers into PDF page indices. CAUTION: printed page numbers and PDF page indices usually differ (covers/contents shift them). Calibrate the offset by finding a page whose printed page number is visible in its text and comparing it with its === PDF PAGE n === marker. Apply that offset to every TOC entry. Report PDF indices only.
3. For each section, set end_page to the page before the next section starts (the last section of interest ends where the following section begins). Never exceed the total page count you are given.
4. Mark each section relevant: true ONLY if its obligations can be CHECKED BY READING A PIECE OF MARKETING/CONSUMER-COMMUNICATION TEXT ON ITS OWN. Apply this test strictly:
   - RELEVANT: rules about what communications must/must not contain or how they must be presented (clear/fair/not misleading, required warnings, balance, prominence), overarching conduct principles that communications can breach (good faith, avoiding foreseeable harm), definitions that scope those rules.
   - NOT relevant: obligations on firm PROCESSES that cannot be verified from a text alone — product design and governance, pricing / fair-value assessments, post-sale support operations, monitoring, board reporting, implementation timetables.
   - NOT relevant: executive summaries and scope/applicability chapters that merely preview or restate obligations detailed in later chapters — extracting from them would duplicate rules.
   - NOT relevant: narrative feedback summaries, cost-benefit analysis, respondent lists, abbreviations.
5. If the contents does not state a section's page range and you cannot infer it reliably from the front matter (common for trailing annexes/appendices), mark it relevant: false and say so in the reason — never guess a page range.
6. Give a one-sentence reason for every section, relevant or not — nothing is silently dropped.

COMPLIANCE GOAL: ${TASK_INTENT}

Be precise about page numbers; a downstream deterministic step will slice exactly the pages you name.`;

export function plannerUser(frontMatter: string, totalPages: number): string {
  return `Total pages in the PDF: ${totalPages}.\n\nFRONT MATTER:\n\n${frontMatter}`;
}
