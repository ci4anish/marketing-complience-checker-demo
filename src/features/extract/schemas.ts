import { z } from "zod";

/**
 * Stage 1 (`scan`) — per-window page classification. One window call returns
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
 *
 * `Rule`/`RuleSet` are the artifact contract between the two features: the
 * extract feature PRODUCES data/rules.json; the check feature CONSUMES it
 * (see src/features/check/schemas.ts).
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
 * Map-reduce extractor (alternative strategy, `extract:mapreduce`).
 * `DraftRule` is a Rule WITHOUT an id: the per-window MAP step extracts rules
 * from a single window with no global view, so it can't assign stable IDs —
 * the REDUCE (dedupe) step merges the drafts and numbers the survivors.
 */
export const DraftRule = Rule.omit({ id: true });
export type DraftRule = z.infer<typeof DraftRule>;

export const WindowRules = z.object({
  rules: z.array(DraftRule).describe("Checkable rules whose obligation appears on the pages in this window; empty if none"),
});
export type WindowRules = z.infer<typeof WindowRules>;
