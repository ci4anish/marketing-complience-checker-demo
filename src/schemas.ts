import { z } from "zod";

/**
 * Stage 1 (`plan`) — the planner's reading of the document's table of contents.
 * One entry per document section it can identify; `relevant` flags the ones
 * that contain obligations applicable to marketing/consumer communications.
 * Pages are PDF page indices (1-based), NOT the document's printed page numbers.
 */
export const SectionPlan = z.object({
  title: z.string().describe("Section title as it appears in the contents"),
  start_page: z.number().int().min(1).describe("First PDF page of the section (1-based PDF index, from the === PDF PAGE n === markers)"),
  end_page: z.number().int().min(1).describe("Last PDF page of the section (inclusive)"),
  relevant: z.boolean().describe("true if the section states obligations applicable to marketing / consumer communications"),
  reason: z.string().describe("One sentence: why this section is or is not relevant to the compliance goal"),
});

export const ExtractionPlan = z.object({
  document_title: z.string(),
  sections: z.array(SectionPlan),
});
export type ExtractionPlan = z.infer<typeof ExtractionPlan>;

/**
 * Stage 1b (`scan`) — per-window page classification. One window call returns
 * the pages (within that window) that contain checkable obligations. Merging
 * across windows is a trivial page-set union — this is why parallelism lives
 * here and not in rule extraction (DECISIONS.md D11/D12).
 */
export const WindowScan = z.object({
  relevant_pages: z.array(
    z.object({
      page: z.number().int().min(1).describe("PDF page index (from the === PDF PAGE n === marker)"),
      reason: z.string().describe("One short clause: what checkable obligation content this page holds"),
    }),
  ),
});
export type WindowScan = z.infer<typeof WindowScan>;

/** Aggregated scan output written to data/scan.json. */
export const ScanResult = z.object({
  total_pages: z.number().int(),
  window_size: z.number().int(),
  relevant_pages: z.array(z.object({ page: z.number().int(), reason: z.string() })),
  ranges: z.array(z.object({ from: z.number().int(), to: z.number().int() })),
});
export type ScanResult = z.infer<typeof ScanResult>;

/**
 * Stage 3 (`extract`) — one discrete, checkable compliance rule.
 * `check` is the operationalization: the concrete yes/no question an evaluator
 * asks of a piece of marketing text. This is what makes a rule *checkable*
 * rather than a restated paragraph.
 */
export const Rule = z.object({
  id: z.string().describe("Stable short ID, e.g. CU-01 (consumer understanding), CC-02 (cross-cutting)"),
  category: z
    .string()
    .describe(
      "Short snake_case label derived from the document's OWN structure (its principles, outcomes, or chapter themes) — not from a predefined list",
    ),
  principle: z.string().describe("The obligation, stated in one sentence"),
  check: z.string().describe("Concrete yes/no question to ask of a marketing text to test compliance"),
  red_flags: z.array(z.string()).describe("Phrases/patterns in marketing text that typically indicate a breach"),
  source: z.string().describe("Citation into the document, e.g. 'PS22/9 Ch.8 §8.14' or 'PRIN 2A.5.3R'"),
  severity: z.enum(["high", "medium", "low"]).describe("high = breach likely makes the material non-compliant on its own"),
});
export type Rule = z.infer<typeof Rule>;

export const RuleSet = z.object({
  source_document: z.string(),
  scope_note: z.string().describe("What was scoped in/out of extraction and why"),
  rules: z.array(Rule),
});
export type RuleSet = z.infer<typeof RuleSet>;

/**
 * Stage 4 (`check`) — one verdict per rule. Field order is deliberate:
 * `reasoning` precedes `verdict` so the model writes its analysis before
 * committing (structured outputs generate fields in schema order — the
 * verdict tokens are conditioned on the reasoning already written).
 */
export const Verdict = z.object({
  rule_id: z.string(),
  reasoning: z.string().describe("The analysis that leads to the verdict — written BEFORE the verdict"),
  evidence: z
    .string()
    .nullable()
    .describe("VERBATIM quote from the input text for commission breaches; null for omission breaches (reasoning must name what is absent) and for non-breach verdicts"),
  verdict: z.enum(["compliant", "non_compliant", "not_applicable", "needs_review"]),
  fact_to_verify: z
    .string()
    .nullable()
    .describe("Required when verdict is needs_review: the specific external fact to verify. null otherwise"),
});
export type Verdict = z.infer<typeof Verdict>;

export const CheckOutput = z.object({
  verdicts: z.array(Verdict).describe("Exactly one verdict per rule in the ruleset"),
  summary: z.string().describe("One short paragraph: overall assessment of the text"),
});
export type CheckOutput = z.infer<typeof CheckOutput>;
