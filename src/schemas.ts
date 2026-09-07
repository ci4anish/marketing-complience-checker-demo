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
 * Stage 3 (`extract`) — one discrete, checkable compliance rule.
 * `check` is the operationalization: the concrete yes/no question an evaluator
 * asks of a piece of marketing text. This is what makes a rule *checkable*
 * rather than a restated paragraph.
 */
export const Rule = z.object({
  id: z.string().describe("Stable short ID, e.g. CU-01 (consumer understanding), CC-02 (cross-cutting)"),
  category: z.enum([
    "consumer_principle",
    "cross_cutting",
    "consumer_understanding",
    "consumer_support",
    "vulnerable_consumers",
  ]),
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
