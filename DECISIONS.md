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

## Surprises / notes during build

- The FCA task PDF's own example ("get rich tomorrow 🚀") maps almost 1:1 onto PS22/9 Ch 8
  consumer-understanding obligations — the brief was clearly written with Consumer Duty in mind.
- (log more here as they happen)
