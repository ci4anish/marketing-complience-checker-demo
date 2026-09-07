# Checker eval — results & findings

Scored via `npm run eval:checker` (src/commands/checker-eval.ts) against the 24-case golden
set in `evaluations/checker-eval/`. Hard gate = band + must_flag + verbatim evidence;
diagnostics = must_not_flag / expect_needs_review / expect_not_applicable (see that README).

## Score trajectory (three runs, two fixes)

| Run | Hard pass | Bands alone | What changed before it |
|---|---|---|---|
| 1 | 11/24 | 20/24 | baseline |
| 2 | 20/24 | 21/24 | harness fix (evidence fragments) + WARN-band calibration |
| 3 (final) | 18/24 | 21/24 | product-terms carve-out fix; two medium-severity cases flipped back on run variance |

**Finding 1 — the biggest "failure" was a harness bug, not a judge failure.** Run 1's dominant
failure (8 cases) was `evidence_verified=false` on quotes that were in fact honest: the judge
cites MULTIPLE verbatim fragments (a breach scattered across a text) joined by newlines, and
the verifier required one contiguous substring. Fix: verify per-fragment (split on newlines/
ellipses). Zero evidence failures in every run since. Lesson: when an LLM fails an automated
check en masse, audit the check before the LLM.

**Finding 2 — "presumed accurate ≠ presumed acceptable."** The substantiation boundary added
during fixture testing ("the firm's own product terms are presumed accurate — judge only
presentation") backfired on case 12: the judge began treating *openly disclosed but harmful*
terms (£25 exit fee, post-only closure, 30 working days) as compliant because they were
honestly stated. One clarifying sentence — disclosure of an unreasonable barrier does not make
it compliant; judge substance under conduct rules — fixed it. Lesson: every carve-out you give
an LLM judge will be stretched to cases you didn't intend; state the limit of the carve-out in
the same breath.

**Finding 3 — residual weakness is verdict variance on medium/low presentation rules.**
Cases 08 (jargon) and 22 (complexity-tailoring) pass on some runs and miss on others; bands
stay stable (21/24 every run) because variance concentrates in whether a medium-severity rule
is flagged alongside the highs. High-severity behaviour (the FAIL cases, the false-positive
guards, negated red flags, format-appropriateness) is stable across all runs. Future work,
deliberately not built: self-consistency voting (N=3 majority per verdict) would likely
stabilize the mediums at 3× the cost.

## Documented disagreements with the golden set (not "fixed"; per its own README these are
investigation prompts, not auto-defects)

- **Case 13 (CU-14/CU-15 scope-leakage):** the extracted rules are conditionals ("IF the
  instrument is limited to professionals…"); the ad *removes* the restriction ("available to
  everyone. No eligibility checks"), so the judge reads the condition as unmet → not_applicable
  — while still FAILing the case on ~16 other rules. Both readings defensible; the case fails
  only on the pinned IDs, not on outcome.
- **Case 15 ("lowest fees of any UK broker — guaranteed"):** pinned WARN/needs_review; the
  judge consistently calls it a high breach. "Guaranteed" attached to a market-position
  superlative is arguably misleading-even-if-true — a genuine boundary case (the eval's own
  case-06 caveat acknowledges this class).
- **Case 18 (disclaimer overload):** 13 boilerplate disclaimers vs a 3-word headline; the
  judge persistently declines to call the low-severity overload rule. Real leniency on
  presentation-only defects, consistent with Finding 3.

## Stopping decision

Six checker-prompt iterations total (three during fixture testing, three here). Fixes were
accepted only when they addressed a *mechanism* (harness bug, carve-out overreach, boundary
definition) — not to chase individual pins. Remaining gap to 24/24 is: two contestable pins,
one boundary case, and medium-severity variance. Tuning further against this specific set
would be overfitting to one reviewer's judgment, which its README explicitly warns is not
ground truth.
