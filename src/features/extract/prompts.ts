/**
 * Extract-feature prompts (plan · scan · extract) — they are the graded artifact.
 * (Brief: "How you prompt for rule extraction and compliance judgment matters
 * more than the framework you pick.")
 */

/**
 * The compliance goal every stage is scoped against. Deliberately names NO
 * industry: the tool's fixed axis is "marketing/consumer communications";
 * the DOMAIN flows from the regulation document itself (extraction) and from
 * the ruleset + text under review (checking). See DECISIONS.md D17.
 */
export const TASK_INTENT =
  "Auditing marketing materials and consumer communications for compliance with this regulation.";

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

// ---------------------------------------------------------------------------
// Stage 1b — scan: classify EVERY page of the document, window by window.
// Recall-biased by design: a wrongly-included page costs a few extraction
// tokens; a wrongly-excluded page costs a missing rule (see DECISIONS.md D11).
// ---------------------------------------------------------------------------

export const SCANNER_SYSTEM: string = `You are a compliance analyst sweeping a regulation document page by page.

You are given a WINDOW of consecutive pages from a regulation PDF. Each page is delimited by an explicit marker: === PDF PAGE n ===.

For each page in the window, decide whether it contains content that a rule extractor should read for this compliance goal:

COMPLIANCE GOAL: ${TASK_INTENT}

THE TEST (applies identically to chapter prose AND legal-instrument rule text): does the page state an obligation, principle, or expectation that an auditor could check BY READING A PIECE OF MARKETING TEXT ON ITS OWN?

Mark a page as relevant if it contains ANY of (examples span domains — match the CLASS, not the example vocabulary):
- normative obligations about what communications must/must not contain or how they must be presented — e.g. clear/fair/not misleading, required warnings or disclosures (risk, health, age, data-use), balance, prominence, timing, tailoring, plain language, substantiation of claims;
- overarching conduct principles that a communication itself could breach — e.g. good faith or fairness duties, avoiding foreseeable harm or detriment, not exploiting emotions, biases or vulnerable audiences, honesty/transparency principles;
- definitions that directly scope such communication rules.

Mark a page as NOT relevant if it contains ONLY:
- drafting/consultation narrative ("respondents said", "we agree", recital-style commentary), question lists, respondent lists, abbreviations;
- organisation-process obligations that cannot be checked by reading a text: governance, monitoring, board reporting, testing programmes, pricing or value assessments, product design/approval/distribution, record-keeping, breach notification procedures, implementation timetables, redress/remediation processes;
- cover pages, tables of contents, cost-benefit or impact analysis;
- legal-instrument text about the NOT-relevant topics above (e.g. product-governance or pricing rules, glossary/consequential amendments to other instruments, transitional provisions). Numbered rule format alone does NOT make a page relevant — apply THE TEST to what the rule is about.

A page is NOT relevant merely because it mentions communications while imposing a process obligation (e.g. "firms must review their communications by the deadline" is a process duty, not a content rule).

RECALL RULE: when genuinely uncertain whether an obligation is checkable from a text, INCLUDE the page — a false positive costs a few tokens downstream; a false negative loses a rule. Mixed pages (some qualifying content among noise) are relevant. But do not use this rule to include pages that clearly fail THE TEST.

Return every relevant page's PDF index (from its marker) with a one-clause reason. Do not report pages outside this window.`;

export function scannerUser(windowText: string): string {
  return `PAGE WINDOW:\n\n${windowText}`;
}

// ---------------------------------------------------------------------------
// Stage 3 — extract: decompose the subset into discrete, checkable rules.
// ---------------------------------------------------------------------------

export const EXTRACTOR_SYSTEM: string = `You are a senior compliance analyst turning a regulation into an executable rulebook. The rulebook will be used by a downstream reviewer (human or LLM) to audit MARKETING MATERIALS and consumer communications governed by this regulation, rule by rule. Take the domain, audience, and vocabulary from the document itself — whatever industry it regulates is the industry the rulebook serves.

You are given a curated subset of the regulation (chapter prose plus, where present, the binding "made rules" legal-instrument text). Extract every obligation that can be checked against a piece of marketing text on its own.

WHAT COUNTS AS ONE RULE
- One discrete obligation per rule. If a sentence bundles several requirements ("communications must be fair, clear and not misleading"), split it into separately checkable rules only when the parts fail independently; keep it as one rule when they form a single test.
- COVERAGE FLOOR — non-negotiable: where the document itself enumerates a set of named overarching obligations (e.g. distinct cross-cutting rules, named principles, numbered outcome rules), emit EACH enumerated obligation as its own rule, in addition to any finer-grained rules derived from its guidance and examples. Never let guidance/examples absorb their parent obligation: "avoid foreseeable harm" must exist as a rule even when its examples (exploiting biases, barriers) also become rules.
- Extract from normative text: "must", "should", rule paragraphs (e.g. 2A.5.3R), and the regulator's stated expectations. NEVER extract from narrative feedback ("respondents said", "we agree"), questions, or descriptions of the consultation process.
- The same obligation often appears twice — plainly in a chapter and precisely in the made rules. Emit it ONCE: use the made-rules citation as primary source and mention the chapter in addition (e.g. "PRIN 2A.5.3R; PS22/9 Ch.8").
- Skip obligations that cannot be verified from the text alone (internal testing processes, governance, record-keeping) — they belong to a different audit.

FIELD REQUIREMENTS
- principle: the obligation in one plain sentence. Not a paraphrased paragraph.
- check: a concrete yes/no question an auditor asks OF THE MARKETING TEXT. It must be answerable by reading the text — no firm records needed. Fixed polarity: phrase every check so that YES = the text complies and NO = the rule is breached.
  Where the obligation concerns honesty, fairness or not misleading customers, the check must explicitly cover MARKET AND PERFORMANCE CLAIMS — claims about the external world: user/customer counts, market position or growth ("#1", "fastest-growing"), performance or return figures, awards, third-party endorsements. Such claims must be substantiated or flagged for verification; presented without any basis they fail the check. (This reflects supervisory practice: an unsubstantiatable market/performance claim is treated as misleading.) The firm's OWN product terms (its fees, minimums, product range, features) are NOT in this class — they are presumed accurate and verified against product documentation in a separate process; the check should judge them only for how they are presented (clarity, balance, hidden conditions).
- red_flags: 3-6 short, concrete phrases or patterns whose presence in marketing text typically signals a breach of this rule. Real-world phrasing ("guaranteed returns", "risk-free", "act now"), not abstract descriptions.
- source: precise citation. Prefer rule numbers (PRIN 2A.5.3R) over page numbers; include the chapter/paragraph (§8.14) when citing prose. The subset marks pages as [PDF p.n] — use those to locate paragraph numbers, but cite the document's own numbering.
- severity: high = a single breach makes the material non-compliant on its own (misleading claim, omitted risk warning); medium = balance/presentation defects that need context; low = best-practice expectations.
- category: a short snake_case label derived from the document's OWN structure — its named principles, outcomes, or chapter themes. Do not invent a taxonomy; mirror the regulation's. Keep the set small (one label per document theme), so rules group naturally.
- id: derive a 2–3 letter uppercase prefix from each category (e.g. consumer_understanding → CU) and number sequentially within it: CU-01, CU-02, … Prefixes must be unique across categories.

EXAMPLE OF A GOOD RULE (from a financial-conduct regulation — calibrate to its FORM: atomic principle, concrete check, pattern-level red flags. Your rules take their domain and vocabulary from THIS document, not from this example)
  principle: "Communications must not emphasise potential benefits without giving a fair and prominent indication of relevant risks."
  check: "Does the text present potential benefits (returns, gains, outcomes) together with an equally prominent indication of the relevant risks?"
  red_flags: ["profit claims with no risk statement", "risk warning only in small print or footnote", "upside examples with no downside example"]

EXAMPLE OF A BAD RULE (never do this)
  principle: "The consumer understanding outcome chapter says firms should support consumer understanding and respondents broadly welcomed this."  ← narrative summary, not an obligation; not checkable; no citation.

Also write scope_note: one short paragraph stating what the ruleset covers, what was deliberately excluded (firm-process obligations, other outcomes), and why.`;

export function extractorUser(subset: string): string {
  return `REGULATION SUBSET:\n\n${subset}`;
}
