# Checker evaluation — Stage 4 (`check`) golden dataset

Evaluates the **compliance judge** ([src/commands/check.ts](../../src/commands/check.ts) +
`CHECKER_SYSTEM` in [src/prompts.ts](../../src/prompts.ts)): given a marketing text and the
extracted rulebook, does it return the right overall **band** and catch the right **problems**,
with honest evidence — without hallucinating breaches or hiding behind `needs_review`?

Counterpart to [../extraction-eval/](../extraction-eval/), which checks the *rules*. Extraction
eval asks "are the rules right?"; checker eval asks "given the rules, are the judgments right?".

## What's here

- `cases/*.txt` — 24 marketing/communication artifacts, each engineered to exercise a specific
  outcome (a breach type, a `needs_review`, a clean pass, a false-positive trap).
- `expected.json` — golden expectations per case.
- `validate.mjs` — deterministic structural checker (no LLM, no `rules.json`).
- `smoke/` — the fast 3-case smoke test wired into `npm run check:fixtures`.

## No rule IDs — and why

**This dataset references no rule IDs.** The `extract` stage is non-deterministic: re-running it
regenerates `data/rules.json` with a different rule count, taxonomy, and numbering (observed
during the build: 38 → 32 → 33 rules, with categories renamed each time). Any eval pinned to
those IDs rots on the next `extract`.

So instead of *"rule CU-02 must be flagged"* we assert on things that **never change when you
re-extract**:

1. the **band** (PASS/WARN/FAIL) — deterministic from verdict counts, names no rule;
2. **verbatim phrases** from the fixture text — e.g. the offending `"get rich tomorrow"`, or the
   innocent `"Capital at risk"` that must *not* be flagged.

The judge already emits `evidence` (a verbatim quote) per finding, so "was this problem caught?"
becomes "does some `non_compliant` verdict quote this phrase?" — checkable, meaningful, and
immune to ID churn. This tests whether the judge caught the right *problem*, which matters more
than which rule ID it attached.

## The four fields

| Field | Assertion |
|---|---|
| `band` | Exact PASS/WARN/FAIL. Hard assertion. |
| `must_catch` | Each phrase must be quoted as `evidence` by some `non_compliant` verdict (normalized substring match, so a longer quote still counts). |
| `expect_needs_review` | At least one phrase must be quoted by a `needs_review` verdict (unverifiable external fact). |
| `forbid_flag` | None of these (risk warnings, anti-pressure wording) may be quoted by a `non_compliant` verdict. False-positive guard. |

`_band_driven: true` marks the one case (18) whose defect is an *aggregate* (disclaimer overload)
with no single offending phrase — there the band is the whole assertion.

## Coverage (verified by `validate.mjs`)

**24 cases · bands: FAIL ×12, WARN ×5, PASS ×7.** All four verdict types are the primary focus
of at least one case: `non_compliant`, `needs_review` (07, 15, 23), `not_applicable`-heavy
(11, 24), `compliant` (09, 10, 14, 20).

Compliance dimensions exercised: misleading claims, risk-balance & omission, pressure/urgency &
FOMO, vulnerability targeting, support/exit barriers, professional-only scope leakage, remedial
notices, format-appropriateness, and false-positive robustness.

| Case | Band | What it tests |
|---|---|---|
| 01 crypto get-rich FOMO | FAIL | hype + FOMO + no risk warning |
| 02 guaranteed returns | FAIL | misleading claim → breach, **not** `needs_review` |
| 03 target vulnerable/debt | FAIL | vulnerability exploitation |
| 04 CFD leverage | FAIL | unbalanced upside; a bare risk line must not auto-pass |
| 05 deposit bonus + urgency | FAIL | manufactured urgency + inducement |
| 06 profit testimonial | FAIL | testimonial implying typical returns |
| 07 awards / user-count | WARN | **clean `needs_review`** (verifiable facts) |
| 08 jargon, simple product | WARN | medium-only defect (calibration) |
| 09 compliant crypto | PASS | high-risk product done right (false-positive guard) |
| 10 compliant ISA | PASS | mainstream balanced ad |
| 11 service maintenance | PASS | non-promotional notice → nothing to flag |
| 12 support exit barriers | FAIL | unreasonable barriers to exit |
| 13 pro product → retail | FAIL | professional-only scope leakage |
| 14 remediation notice | PASS | harm notice done right → compliant |
| 15 comparative "lowest fees" | WARN | `needs_review` on a comparative/price claim |
| 16 FSCS/"fully protected" | FAIL | protection misrepresentation |
| 17 advice-style recommendation | FAIL | unbalanced "buy now" + urgency |
| 18 disclaimer overload | WARN | aggregate presentation defect (calibration) |
| 19 mostly-OK + one breach | FAIL | discrimination + **evidence localization** |
| 20 minimal banner | PASS | **format-appropriateness** |
| 21 red-flags in negation | PASS | **strongest false-positive guard** |
| 22 complex autocall "simple" | FAIL | complex product mis-sold as simple |
| 23 past-performance figure | WARN | compliant-vs-`needs_review` boundary |
| 24 educational "What is an ETF?" | PASS | neutral non-promotional info |

## How to score it

The primary signal is the **band**. Then per case: every `must_catch` phrase should appear in
some `non_compliant` verdict's evidence; at least one `expect_needs_review` phrase in a
`needs_review` verdict; no `forbid_flag` phrase in any `non_compliant` verdict. Matching uses the
same normalization the check stage uses for its evidence test (lowercase, collapse whitespace,
unify quotes/dashes) — so a judge quoting a longer fragment that contains the phrase still counts.

A scorer wired to live `check` output is a ~40-line follow-up (iterate `cases/`, run `runCheck`,
apply the phrase/band assertions above). Left as a follow-up so this commit is data-only.

### Validate the dataset (no LLM, no `rules.json`)

```
node evaluations/checker-eval/validate.mjs
```

Confirms every asserted phrase actually occurs in its fixture (so no assertion is
unsatisfiable), bands are internally consistent, and every fixture has an expectation. Because it
touches no rule IDs, **it never needs re-running after `extract`** — the whole point of the
ID-free design.

## Caveats

- `must_catch` matches a specific phrasing. Where a text has several equivalent offending phrases
  (e.g. case 08's jargon terms), we pick the most likely-quoted one and lean on the band; those
  are marked CALIBRATION cases. A mismatch there is a prompt-tuning signal, not necessarily a bug.
- This is one reviewer's judgment, not ground truth. Case 06 (testimonial) sits near the
  WARN/FAIL line — pinned FAIL on the misleading-framing reading, but a judge routing the £5,000
  claim to `needs_review` is defensible.
- Expected verdicts are reasoned predictions; the 24 cases have not yet been run through `check`
  against a live key.

## Note on `smoke/`

`smoke/expected.json` (the 3-case wired smoke test) still uses `must_flag` with rule IDs, because
`check-fixtures.ts` reads that field. To make the project fully ID-free, that harness + its
expectations would move to the same band/phrase scheme — a small code change, offered separately.
