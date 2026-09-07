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
- **Eval-driven fix (see evaluations/extraction-eval.md):** scored the pipeline against an
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
