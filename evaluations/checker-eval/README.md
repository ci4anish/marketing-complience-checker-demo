# Checker evaluation — Stage 4 (`check`) golden dataset

Evaluates the **compliance judge** ([src/commands/check.ts](../../src/commands/check.ts) +
`CHECKER_SYSTEM` in [src/prompts.ts](../../src/prompts.ts)): given a marketing text and the
extracted rulebook (`data/rules.json`), does it return the right verdict per rule, the right
overall band, and honest evidence — without hallucinating breaches or hiding behind
`needs_review`?

This is the counterpart to [../extraction-eval/](../extraction-eval/), which evaluates the
*rules* the judge consumes. Extraction eval asks "are the rules right?"; checker eval asks
"given the rules, are the verdicts right?".

## What's here

- `cases/*.txt` — 14 marketing/communication artifacts, each engineered to exercise specific
  verdicts, bands, and rule categories.
- `expected.json` — golden expectations per case.

## The cases are realistic, not real-verbatim

Copy is **synthetic but modelled on real, documented FCA financial-promotion concern areas**
— crypto FOMO/get-rich hype, "guaranteed/risk-free" returns, targeting people in financial
difficulty, CFD leverage with unbalanced risk, deposit-bonus inducements + manufactured
urgency, finfluencer profit testimonials, unverifiable award/user-count claims, jargon,
exit-friction/support barriers, professional-product scope leakage, and redress notices.
Platform names (NovaTrade, CoinSafe, TradeApp, CoinRocket) are invented to avoid impersonating
real firms; the *patterns* are what real enforcement targets. This keeps the dataset honest and
safe to commit while still being a faithful stress test.

## Coverage (verified by `validate.mjs`)

**24 cases.**

| Dimension | Covered |
|---|---|
| **Bands** | FAIL ×12, WARN ×5, PASS ×7 |
| **Verdict types** | `non_compliant`, `needs_review`, `not_applicable`, `compliant` — each is the *primary focus* of at least one case |
| **Rule categories** | all six in the live ruleset: `consumer_principle` (CP), `cross_cutting` (CC), `consumer_understanding` (CU), `consumer_support` (CS), `vulnerable_customers` (VU), `financial_promotion_scope` (FM) |

The existing `tests/fixtures/` smoke test only exercises CP/CC/CU and FAIL/WARN/PASS on 3
cases. This set adds the under-tested categories and the two under-tested verdicts
(`needs_review`, `not_applicable`) as first-class scenarios, plus deliberate false-positive
guards and calibration cases.

### Case → what it tests

Cases 01–14 are the base set; 15–24 were added to fill gaps (more `needs_review`, more WARN,
a mostly-compliant "single buried breach" discrimination test, a format-appropriateness case,
and the strongest false-positive guard).

| Case | Band | Primary outcome tested |
|---|---|---|
| 01 crypto get-rich FOMO | FAIL | multiple high `non_compliant` (hype, FOMO, no risk) |
| 02 guaranteed returns | FAIL | misleading claim → `non_compliant`, **not** `needs_review` |
| 03 target vulnerable/debt | FAIL | vulnerability exploitation (CC-04) + `vulnerable_customers` |
| 04 CFD leverage | FAIL | unbalanced upside; a bare risk line must not auto-pass |
| 05 deposit bonus + urgency | FAIL | manufactured urgency + inducement |
| 06 profit testimonial | FAIL | unrepresentative testimonial implying typical returns |
| 07 awards / user-count | WARN | **clean `needs_review`** (externally verifiable facts) |
| 08 jargon, simple product | WARN | **medium-only** defect → WARN (calibration) |
| 09 compliant crypto | PASS | high-risk product done right → `compliant` (false-positive guard) |
| 10 compliant ISA | PASS | mainstream balanced ad → `compliant` |
| 11 service maintenance | PASS | **mass `not_applicable`** on non-promotional text |
| 12 support exit barriers | FAIL | **CS** category (unreasonable barriers to exit) |
| 13 pro product → retail | FAIL | professional-only **scope leakage** (CU-14/CU-15) |
| 14 remediation notice | PASS | non-promotional harm notice → `compliant` on clarity/good-faith |
| 15 comparative "lowest fees" | WARN | `needs_review` on a comparative/price claim |
| 16 FSCS/"fully protected" | FAIL | protection misrepresentation |
| 17 advice-style recommendation | FAIL | unbalanced "buy now" recommendation + urgency |
| 18 disclaimer overload | WARN | disclaimer/overload defect → WARN (calibration) |
| 19 mostly-OK + one breach | FAIL | discrimination + **evidence localization** (verbatim quote) |
| 20 minimal banner | PASS | **format-appropriateness** (don't demand what a banner can't carry) |
| 21 red-flags in negation | PASS | **strongest false-positive guard** |
| 22 complex autocall "simple" | FAIL | complex product mis-sold as simple |
| 23 past-performance figure | WARN | compliant-vs-`needs_review` boundary on a data point |
| 24 educational "What is an ETF?" | PASS | `not_applicable`-heavy non-promotional info |

## ⚠️ Rule-ID drift — read before trusting results

The `extract` stage is **non-deterministic**: re-running it regenerates `data/rules.json`
with a different rule count, taxonomy, and numbering. During this dataset's construction the
live ruleset changed from 38 rules (FM/RM categories) → 32 (PS/PV/RM) → 33
(`vulnerable_customers`/`financial_promotion_scope`) across runs. The IDs here are pinned to
the fingerprint recorded in `expected.json._ruleset` (33 rules; prefixes CP/CC/CU/CS/VU/FM).

**After every `npm run extract`, run the validator and re-map if it reports drift:**

```
node evaluations/checker-eval/validate.mjs
```

It fails loudly on fingerprint mismatch, unknown rule IDs, band/severity inconsistency, and
missing fixtures — so a stale mapping can never pass silently. To reduce churn,
`expect_not_applicable` intentionally leans on structurally-stable always-n/a rules
(distribution-chain, one-to-one, professional-only) rather than volatile tail categories.

> Recommendation for the pipeline: make extraction reproducible (e.g. temperature 0 and/or a
> stable-ID convention keyed on the source citation) so evals don't need re-mapping each run.
> Tracked as a follow-up, not fixed here.

## Scoring semantics

Following `tests/fixtures/expected.json`'s philosophy: **pin what is stable, conservatively.**
Full verdict-per-rule goldens would be brittle against harmless model variation, so per case:

**Hard assertions** (a miss = judge failure; these mirror what `check-fixtures.ts` already enforces):
- `band` — deterministic from verdict counts, so reliable. Must match exactly.
- `must_flag` — these rule IDs **must** be `non_compliant`. Only the most defensible breaches are listed.
- (implicit) every quoted `evidence` must be found verbatim in the input (`evidence_verified !== false`) — the check stage already computes this.

**Diagnostic assertions** (softer — a miss is a smell to investigate, not necessarily a hard fail):
- `must_not_flag` — these must **not** be `non_compliant` (false-positive guards: risk-warning present, anti-pressure phrasing like "there's no rush", "Take your time").
- `expect_needs_review` — **at least one** listed ID should be `needs_review` (a claim compliant-if-true / misleading-if-false).
- `expect_not_applicable` — representative IDs whose subject matter is absent; scored as a proportion, not all-or-nothing.

Rationale for the split: bands and must-flags are robust; exact `not_applicable`/`compliant`
partitions drift run-to-run, so they inform rather than gate.

## How to run

The current harness (`npm run check:fixtures` → `check-fixtures.ts`) is wired to
`tests/fixtures/` and enforces `band` + `must_flag` + evidence. To score this richer set you
can either:

1. **Point the existing harness here** — it reads any `expected.json` with `band`/`must_flag`;
   extra fields are ignored, so `band` + `must_flag` + evidence are checked out of the box:
   ```
   # per case:
   npm run check -- --input evaluations/checker-eval/cases/01-crypto-getrich-fomo.txt \
                    --rules data/rules.json --out data/report.eval-01.json
   ```
2. **Extend the scorer** to also assert `must_not_flag`, `expect_needs_review`,
   `expect_not_applicable` (a ~30-line addition to `check-fixtures.ts` that iterates this
   folder). Left as a follow-up so this commit is data-only.

### Validate the dataset (no LLM calls)

```
node evaluations/checker-eval/validate.mjs
```

Checks fingerprint, rule-ID existence, band/severity self-consistency, and fixture parity.
Run it after every `extract` (see the ID-drift section above).

## Caveats

- Rule-ID drift is the main operational hazard — see the dedicated section above and run
  `validate.mjs` after each `extract`.
- Some cases legitimately admit more than one breach; `must_flag` lists only the *load-bearing*
  ones, so the judge is free to flag additional related rules (e.g. case 01 may also fire CC-06,
  CU-01, CU-03) without failing the eval.
- This is one reviewer's judgment, not ground truth. Treat divergences as investigation
  prompts. In particular, case 06 (testimonial) is deliberately near the WARN/FAIL boundary —
  it is pinned FAIL on the misleading-framing reading, but a judge that instead routes the
  specific £5,000 claim to `needs_review` is defensible and worth noting rather than auto-failing.
