import { z } from "zod";

// The rulebook is the extract feature's output artifact; the check feature
// consumes it. Re-exported here so check-stage code has a single schema import.
export { Rule, RuleSet } from "../extract/schemas.js";

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
