# Design decisions & build notes

Running log kept during the build. Feeds the README's thinking doc. Newest at the bottom.

## Decisions

**D1 — Source: FCA PS22/9 (Consumer Duty).** One of the two sources named in the brief; real,
public, downloadable. Committed to the repo (`regulations.pdf`) for reproducibility — it is a
public FCA document.

**D2 — Scope: marketing-relevant chapters only.** PS22/9 is ~160 PDF pages, mostly narrative
feedback ("respondents said…"). The checkable obligations relevant to *marketing materials*
concentrate in: Ch 4 (Consumer Principle), Ch 5 (cross-cutting rules), Ch 8 (consumer
understanding outcome), plus the PRIN 2A sections of Appendix 1 (the legal instrument). We
explicitly do NOT attempt 100% rule recall — the brief says to scope and be explicit. Cut:
price & value, consumer support, governance, implementation-timeline chapters.

**D3 — Rule extraction is a one-time preprocessing pass, not a runtime stage.** Permitted
explicitly by the brief ("one-time preprocessing pass or part of the agent pipeline — make your
choice visible"). The extraction prompt lives in the repo (`src/prompts.ts`), the pass is
re-runnable (`npm run extract`), and its output (`data/rules.json`) is committed as an
inspectable artifact. The compliance check consumes the cached rules — fast, cheap, reproducible.

**D4 — Pipeline = 4 separable CLI subcommands: `plan → cut → extract → check`.**
- `plan`: LLM reads the document's front matter (TOC) and decides which page ranges contain
  policy content relevant to marketing-communications compliance. Generalizes the tool beyond
  PS22/9 — point it at another regulation PDF and it plans its own subset.
- `cut`: deterministic page slicing (no LLM) → `data/subset.md`.
- `extract`: LLM decomposition of the subset into typed, checkable rules → `data/rules.json`.
- `check`: rule-by-rule compliance evaluation of an input text (designed after reviewing the
  extracted rules — deliberately sequenced so the verdict schema fits real rule shapes).

**D5 — Printed page numbers ≠ PDF page indices.** TOCs cite printed page numbers; the PDF index
is offset by cover/contents pages. Fix: every page fed to the planner is prefixed with
`=== PDF PAGE n ===` markers and the planner is instructed to return PDF indices, not printed
numbers. `cut` then slices exactly what the planner named. (Candidate for "one thing that
surprised me".)

**D6 — TypeScript + OpenAI SDK, no orchestration framework.** The brief grades prompts over
framework choice. A 4-stage linear pipeline doesn't need LangChain; raw SDK keeps every prompt
and call visible. Structured outputs (zod schemas) guarantee valid JSON at every LLM boundary —
no brittle parsing.

**D7 — Pure-JS PDF extraction (`unpdf`).** The deliverable must "work once reviewer adds their
own LLM key" — i.e. `npm install && npm run …` with zero system dependencies. We prototyped with
poppler's `pdftotext` but rejected it: a native dependency breaks the BYOK promise. `unpdf`
(pdfjs under the hood) extracts per-page text in pure JS.

**D8 — Single-call extraction; parallel map-reduce documented but not built.** The scoped subset
(~20–25 pages) fits one context window. A single extraction call sees all rules at once → the
model itself avoids emitting duplicates, and rule IDs stay stable. Parallel per-chunk extraction
would add a cross-chunk dedup/merge problem (same principle stated in Ch 4 and elaborated in
Ch 8) for zero benefit at this document size. `extract` guards on token count and points to this
note if a future document exceeds the threshold. Explicit cut for the 2–3h timebox.

**D9 — Model is env-configurable (`OPENAI_MODEL`).** Sensible default in code; reviewer can
point at whatever their org has enabled. Small BYOK courtesy, future-proofs the demo.

**D10 — Node 24, `type: module`, `tsx` runner.** No build step for a POC; `tsx` runs TS directly.

**D11 — `scan` replaces TOC-only planning: every page passes in front of the LLM.**
The TOC-only planner had a structural blind spot: it can only select sections the contents
page lists, and PS22/9's TOC gives no page numbers for the 70-page legal-instrument appendix —
which is where the binding rules live. Round 1 of the golden-set eval proved the cost: a
high-severity recall miss, patched by a HUMAN locating pages and hardcoding `cut --extra`
ranges. That patch violates the project requirement: page selection must be autonomous and
recall is non-negotiable. Redesign: a `scan` stage sweeps ALL pages of the document in
parallel windows and asks, per window, which pages contain obligations checkable against a
marketing text. Guarantee by construction: every page is read by the LLM at least once —
no human-chosen ranges, no invisible regions. The scan prompt is recall-biased ("when
uncertain, include the page"): a false-positive page costs a few extraction tokens; a
false-negative page costs a missing rule. Parallelization fits *here* (and not in extraction)
because window outputs are page numbers — merging is a trivial set union with no dedup
problem, unlike merging semantically-duplicated rules. `cut --extra` remains only as a
documented escape hatch; the default flow no longer uses it.

**D12 — Why scan and extract stay two separate LLM passes (not one).**
Considered: since scan reads every page anyway, why not have it return the rules directly —
one pass instead of two? Rejected, for three reasons:
1. *Windowed extraction reintroduces rule-dedup.* The same obligation appears in chapter
   prose and in the made rules — in different windows. Parallel window-extraction yields
   semantic duplicates needing an LLM merge step and unstable IDs. Page-set union has no
   such problem. (Same trade-off as D8, resurfacing in a new disguise.)
2. *Extraction quality needs global context.* The single extract call sees prose + legal text
   together, merges them into one rule with dual citations (e.g. "PRIN 2A.5.3R; PS22/9 Ch.8").
   A window-local extractor cannot.
3. *Iteration cost and auditability.* With stages split, re-running the extraction prompt
   costs only the ~15-page subset, and `data/subset.md` remains the inspectable record of
   exactly what the extractor saw — the artifact that let us root-cause the recall miss.
   A single whole-document extraction call (no windows) would also work technically (~100k
   tokens fits context) but pays full-document cost per iteration, reasons over ~70 pages of
   consultation noise, and destroys that audit seam.
Economic shape: scan = cheap classification over everything; extract = expensive reasoning
over a small, clean input. Cheap eyes everywhere, expensive brain once.

**D13 — No document-specific vocabulary in the schema.** The rule `category` was originally a
hardcoded zod enum of PS22/9's five outcome names — the same disease as hardcoded page ranges,
hiding in the type system. Now a free string: the extractor is instructed to mirror the
document's OWN structure (principles/outcomes/chapter themes) and derive unique ID prefixes
from its categories. Validation that this works: on PS22/9 the model re-derived essentially
the same taxonomy unprompted, plus two organic categories the enum would have forbidden.
General principle: the pipeline's *shape* is fixed (rule/check/red_flags/severity); its
*vocabulary* belongs to the document.

**D14 — Considered: window-extract + LLM dedup (map-reduce) instead of scan → cut → extract.**
Proposal: have the windowed pass extract policies directly, then one more LLM round to merge/
deduplicate. Not fewer LLM rounds (N map + 1 reduce vs N scan + 1 extract — same shape); the
difference is where intelligence sits. Genuine pros: (a) no lossy filter before extraction —
page-level recall is structural, since every page is extracted from (scan false-negatives
can't lose rules); (b) unbounded document scale (no subset-fits-context ceiling). Decisive
cons at this scale: (1) the merge step is UNGROUNDED — it must equate paraphrases (Ch 8 prose
vs 2A.5.3R) without seeing source text, risking silent over-merge (recall loss) and
under-merge (duplicate verdicts); our single extractor makes every merge decision while
reading both texts; (2) global structure is invisible to windows — the round-3
parent-absorption problem becomes unsolvable locally (no window knows the document enumerates
exactly three cross-cutting rules); (3) errors compound across two smart stages with unclear
attribution; (4) extraction-grade reasoning over all 161 pages (incl. ~70 noise pages) on
every run and every prompt iteration; (5) no subset.md audit artifact. Mitigant for our one
weakness: regulations state each obligation in 2–3 places (prose + instrument + guidance), so
a scan false-negative must drop ALL of them to lose a rule; the golden eval is the tripwire.
Verdict: scan → cut → extract at this scale; map-reduce is the correct scale-out when relevant
content itself exceeds one context window. Empirically decidable later: a --strategy flag
A/B-scored against the golden set.

**D15 — Two eval sets, one per LLM stage: `evaluations/extraction-eval/` and `evaluations/checker-eval/`.**
Extraction and checking are separate LLM stages with separate failure modes, so they get
separate golden sets that compose: extraction-eval validates the *rulebook* (recall/precision
vs an independent golden ruleset, matched by MEANING not ID); checker-eval validates the
*verdicts* made against it. The checker set is 24 realistic marketing artifacts (synthetic copy
modelled on real FCA financial-promotion enforcement themes — crypto FOMO, guaranteed returns,
vulnerability targeting, CFD leverage, bonus/urgency, profit testimonials, unverifiable awards,
jargon, exit barriers, professional-product scope leakage, redress notices, plus format-
appropriateness and false-positive traps) engineered to cover, by construction, all three bands
(FAIL/WARN/PASS) and all four verdict types (non_compliant, needs_review, not_applicable,
compliant).

**D16 — Checker-eval is ID-FREE: anchor to band + verbatim fixture phrases, never rule IDs.**
First cut of the checker-eval pinned expectations to rule IDs (`must_flag: ["CU-02"]`). That
broke immediately: `extract` is non-deterministic (D13's free-string `category` regenerates a
different taxonomy/numbering each run — observed live: 38→32→33 rules, categories renamed each
time), so ID-pinned expectations rot on the next `extract`. Root-cause fix: the eval references
NO rule IDs. It asserts only on things that don't change when you re-extract — (1) the `band`
(deterministic from verdict counts, names no rule), and (2) verbatim PHRASES from the fixture
text: `must_catch` (an offending phrase must be quoted as `evidence` by some non_compliant
verdict), `expect_needs_review` (an unverifiable claim must land as needs_review), `forbid_flag`
(an innocent phrase — risk warning, anti-pressure wording — must NOT be flagged). This reuses the
judge's existing verbatim-`evidence` mechanism and tests whether it caught the right *problem*,
which matters more than which rule ID it attached. `validate.mjs` consequently drops its
`rules.json`/fingerprint dependency and instead verifies every asserted phrase actually occurs in
its fixture (no unsatisfiable assertions) + band consistency — so it never needs re-running after
`extract`. Deliberate false-positive guards live in `forbid_flag`: a present risk warning
(case 04/20), anti-pressure phrasing (09/10), and red-flag phrases used in negation (case 21) must
not trip the judge. Remaining coupling: `smoke/expected.json` + `check-fixtures.ts` still use
`must_flag` IDs (the wired 3-case smoke test); converting that harness to band/phrase is the
follow-up to make the project fully ID-free. General principle (mirrors D13): evals key on the
document's stable surface (regulation text, input text, band), never on the extractor's ephemeral
output vocabulary.

**D15 — Check stage: design locked by grilling, then two lessons from fixture testing.**
Design (agreed via Q&A): single call over all rules (category-batching as future escape
hatch); verdicts compliant/non_compliant/not_applicable/needs_review with a strict
needs_review definition (external facts only, named in fact_to_verify); deterministic
PASS/WARN/FAIL band computed in code (any high breach = FAIL; no invented thresholds);
nullable evidence (verbatim quote for commission breaches, null + named absence for
omissions) with a CODE-side substring verification (evidence_verified); reasoning field
precedes verdict in the schema so the verdict is conditioned on written analysis;
completeness check (exactly one verdict per rule ID) as a hard error; digest terminal
output + full report.json; CI exit codes.
Lesson 1 — *the rulebook beats the referee.* The checker kept flip-flopping on "trusted by
30M users" (compliant some runs, needs_review others) despite three rounds of checker-prompt
strengthening. Root cause: no extracted rule mentioned substantiation — "clear, fair, not
misleading" as written is satisfied by a plausibly-true claim, so the model was CORRECTLY
applying the rule and ignoring our meta-instructions. Fix at the source: the extractor now
encodes the substantiation duty (supervisory practice: unsubstantiatable market/performance
claims are treated as misleading) into fairness-type checks. Verdicts stabilized immediately.
Checker-level instruction patches lose to rule text — which is the architecture working as
intended: fix the rulebook, not the referee.
Lesson 2 — *the substantiation class needs a boundary.* First encoding sent EVERY factual
claim to review — the compliant fixture WARNed over its own "$10 minimum" and "3,000 stocks".
Line drawn: MARKET/PERFORMANCE claims (user counts, rankings, returns, awards — external-world
facts) require substantiation; the firm's OWN PRODUCT TERMS (fees, minimums, range) are
presumed accurate and judged on presentation only. Encoded consistently in extractor + checker.
Also: fixtures must sit INSIDE their band, not on a boundary — the first borderline fixture
stacked three superlatives and was legitimately bistable between WARN and FAIL across runs;
a smoke-test fixture that honest judges can disagree about tests nothing.

## Surprises / notes during build

- The FCA task PDF's own example ("get rich tomorrow 🚀") maps almost 1:1 onto PS22/9 Ch 8
  consumer-understanding obligations — the brief was clearly written with Consumer Duty in mind.
- **The planner's first run marked 13/18 sections relevant** (Summary, price & value,
  governance…). The fix wasn't more instructions — it was changing the relevance *test* from
  "contains obligations" to "obligations checkable BY READING A MARKETING TEXT ALONE". One
  sharpened criterion beat a list of exclusions; second run: 5/18, all defensible, and it
  correctly refused to guess the unlisted appendix page range instead of hallucinating one.
- In PS22/9 printed page numbers happen to equal PDF indices (rare luck); the `=== PDF PAGE n ===`
  marker calibration still earns its keep on any document where they diverge.
- PRIN 2A.5 (binding consumer-understanding rules) lives at PDF p.127–131 inside a 70-page
  legal instrument the TOC doesn't paginate. Located via a content probe; added through an
  explicit `cut --extra` operator override rather than faking planner output. Result: 27/31
  extracted rules cite made-rules numbers (2A.5.3R…) instead of only chapter prose.
- **Scan iteration 1 over-included (139/161 pages).** Root cause: a self-contradictory
  criterion — "legal-instrument rule text is relevant" as a blanket bullet meant pricing and
  product-governance rules qualified just for being numbered. Fix: one uniform test ("checkable
  by reading a marketing text") applied to every text form + "mentions communications ≠
  relevant". Second pass: 78/161 with all golden-critical pages included autonomously.
- **Extractor lost a parent obligation on the noisier autonomous subset (12/13):**
  "avoid foreseeable harm" was absorbed by its own guidance examples (exploitation,
  vulnerability rules) — an extraction miss, not a coverage miss. Fix: document-agnostic
  COVERAGE FLOOR ("where the document enumerates named obligations, each becomes its own
  rule; guidance never absorbs its parent") → 13/13. Lesson: LLM extractors drift toward
  specifics; the floor pins the document's own structure.
- **Eval-driven fix (see evaluations/extraction-eval/extraction-eval.md):** scored the pipeline against an
  independently hand-curated golden ruleset. Round 1: 12/13 recall — the miss (no standalone
  "don't exploit emotions/behavioural biases" rule, i.e. the urgency/FOMO/🚀 rule) root-caused
  to a subset gap: PRIN 2A.2 (pp.104–110) wasn't in the operator-added ranges. Widened the
  range, re-extracted → 13/13. Lesson: the dominant extraction-quality lever is subset
  coverage, not prompt wording. Bonus: the pipeline caught a gap in the golden set itself
  (the firm's-role/advice-boundary limb of 2A.5.8R, which golden's CU-08 omits).
- **One extraction defect kept deliberately (round 1):** CC-02's `check` had inverted polarity
  ("Could a customer suffer harm…?" — YES = breach, against the prompt's YES = complies rule).
  Downstream verdicts don't depend on polarity (the check stage returns an explicit
  compliant/non_compliant enum), and `rules.json` is committed exactly as the model produced
  it — no hand-editing, so reviewers see true extraction quality. Amusingly, the independently
  produced golden set made the *identical* polarity slip on the same foreseeable-harm rule.

**D16 — Checker eval (24-case golden set): 11/24 → 20/24 → 18/24 hard; bands stable 21/24.**
Full story in evaluations/checker-eval-results.md. Three lessons worth keeping:
(1) *Audit the harness before the model* — run 1's dominant failure was our evidence verifier
rejecting honest multi-fragment quotes (fixed: per-fragment verification).
(2) *Presumed accurate ≠ presumed acceptable* — the product-terms carve-out (D15) got
stretched by the judge to bless openly-disclosed-but-harmful terms (exit fees, postal-only
closure); every carve-out handed to an LLM judge must state its own limit.
(3) *Know when to stop tuning* — residual gap = two contestable pins, one boundary case, and
run-to-run variance on medium-severity presentation rules (bands never wobble; mediums do).
Chasing 24/24 against one reviewer's pins is overfitting, not improvement. Future lever:
self-consistency voting (N=3 majority) to stabilize mediums, at 3× cost.

**D17 — No industry in the prompts: the document is the domain authority.**
Asked directly: do we need TASK_INTENT's "retail trading/investment platform", and the same
detail in EXTRACTOR/CHECKER? No. The tool's fixed axis is "marketing/consumer communications"
— that phrase is load-bearing in the scan relevance test and the extractor's check-question
framing. The INDUSTRY is not: the regulation document defines its own domain (an FCA paper
yields finance rules and finance red-flags because the text is about financial promotions —
not because we announced a trading platform), the ruleset carries that domain into checking,
and the text under review reveals its own subject. A hardcoded industry is redundant when it
matches the document and distorting when it doesn't (e.g. a gambling ad code audited "for a
trading platform"). Removed from all three prompts; TASK_INTENT is now purpose-only.
rules.json NOT re-extracted after this change: for PS22/9 the output is equivalent (domain
flowed from the document all along) and re-extraction would churn rule IDs, invalidating both
eval pins for zero content benefit. The change matters for the NEXT document, not this one.
Residual soft anchors, accepted: FCA-flavored example lists in the scanner's include/exclude
classes and the extractor's few-shot — illustrations of general classes (conduct principles,
process noise), left as-is to avoid re-tuning a validated prompt; noted for a future
multi-domain test.

**D18 — Soft anchors addressed: multi-domain scanner examples, annotated few-shot.**
Follow-up to D17's audit. The scanner's include/exclude classes now carry cross-domain
examples ("required warnings or disclosures (risk, health, age, data-use)", "fairness duties",
"breach notification procedures") with an explicit instruction to match the CLASS, not the
example vocabulary; the extractor's few-shot is labelled as FORM calibration from a
financial-conduct regulation. Left alone on purpose: the checker/extractor calibration
clauses (substantiation, presumed-accurate-≠-acceptable, presentation-rules — advertising
universals) and the per-document eval sets (correct design: new document → new mini golden
set; known follow-up: stable rule IDs keyed on source citation to eliminate re-pinning).
Validation, full temp chain (live artifacts untouched): re-scan selected every golden-critical
range (Ch4/Ch5/Ch8/P12+2A.2 complete; 2A.5 tail pages 130–131 dropped this run) → cut →
extract scored 13/13 golden with substantiation intact — the dropped tail cost nothing
because regulations state obligations redundantly (prose + instrument), the safety net D14
identified. True multi-domain proof (a second, non-financial regulation end-to-end) remains
the top "with more time" item.

**D1 amendment — regulations.pdf moved out of the repo.** The source PDF now lives in
gitignored `.temp/` (both PDFs; history no longer carries the 1.4MB file — leaner public
repo). CLI defaults updated to `.temp/regulations.pdf`; the README must tell reviewers to
download PS22/9 and drop it there (or pass --pdf). Committed pipeline artifacts
(scan/subset/rules) keep the repo runnable for `check` without the PDF.
