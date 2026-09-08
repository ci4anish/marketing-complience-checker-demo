# Evaluations

Two independent evaluation sets, one per LLM stage of the pipeline. Both are hand-curated
reference data (not pipeline-generated) used to score the system's real output.

| Folder | Evaluates | Question it answers |
|---|---|---|
| [`extraction-eval/`](extraction-eval/) | Stage 3 `extract` | Are the **rules** extracted from the regulation right? (recall / precision / checkability vs a golden ruleset) |
| [`checker-eval/`](checker-eval/) | Stage 4 `check` | Given the rules, are the **verdicts** on a marketing text right? (per-rule verdict, overall band, evidence honesty) |

They compose: extraction-eval validates the rulebook the checker consumes; checker-eval
validates the judgments made against it. A regression in either is caught independently.

- **`extraction-eval/`** — `golden_rules.json` (an independent full-document extraction of
  FCA PS22/9) plus `extraction-eval.md` (the scoring log of `data/rules.json` against it).
- **`checker-eval/`** — `cases/*.txt` (24 realistic marketing artifacts spanning all bands and
  all four verdict types) plus `expected.json`. **ID-free**: it anchors expectations to the
  band + verbatim fixture phrases, never to rule IDs (which drift when `extract` re-runs), so it
  needs no re-mapping. See its README for the design and scoring semantics. Its `smoke/` subfolder
  holds the fast 3-case fixture set wired to `npm run check:fixtures`.

Each folder's `README.md` has the details, including how to run and score it.
