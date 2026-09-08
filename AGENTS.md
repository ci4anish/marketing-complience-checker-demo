# AGENTS.md

Orientation for an AI agent (or new contributor) working in this repo. For the *why* behind the
design, read [README.md](README.md); this file is the *how*.

## What this project is

An LLM-powered **regulation compliance agent**. It does two things:

1. **extract** — turn a regulation PDF into a rulebook of concrete, checkable rules
   (`data/rules.json`).
2. **check** — audit a piece of marketing / consumer-communication text against that rulebook and
   return an overall **PASS / WARN / FAIL** band with a per-rule verdict and quoted evidence.

The pipeline is linear and deterministic in shape: **scan → cut → decompose (extract) → check**.
There is no runtime agent making dynamic decisions — just a fixed sequence of LLM calls with code
around them.

## Setup

- **Node ≥ 24** required (the code uses native `process.loadEnvFile`, `node:util` `parseArgs`).
- `npm install`
- `cp .env.example .env`, then set `OPENAI_API_KEY`. Optional `OPENAI_MODEL` (defaults to `gpt-5.1`).
- **No build step** — [`tsx`](https://tsx.is) runs the TypeScript directly.
- The FCA source **PDF is committed** at `policies-docs/regulations.pdf`; pass `--pdf <file>` to
  target another regulation. It's only needed for `extract`/`scan`/`cut`. `check` runs from the
  committed `data/` artifacts without any PDF.

## Commands

| Command | What it does | Key flags |
|---|---|---|
| `npm run check -- --input <file\|->` | Audit a text against the rulebook → PASS/WARN/FAIL + report. Exit 1 on FAIL. | `--rules data/rules.json` · `--out data/report.json` |
| `npm run extract -- --pdf <file>` | Full rulebook build: scan → cut → decompose → `data/rules.json`. | `--window-size 12` · `--out data/rules.json` |
| `npm run scan -- --pdf <file>` | Sweep every page; classify which hold checkable obligations → `data/scan.json`. | `--window-size 12` · `--out` |
| `npm run cut -- --pdf <file>` | Deterministic (no-LLM) slice of the scanned pages → `data/subset.md`. | `--scan data/scan.json` · `--out` |
| `npm run decompose` | Extract rules from an already-cut subset (debug one stage). | `--subset data/subset.md` · `--out` |
| `npm run eval:checker` | Score the checker against `evaluations/checker-eval/`. Needs a key. | — |
| `npm run typecheck` | `tsc --noEmit`. No key needed. | — |

`--input -` reads the text from stdin.

## Layout

```
src/
  cli.ts                 arg parsing + dispatch only (no business logic)
  core/                  reusable infra
    llm.ts               OpenAI structured-output wrapper (structuredCall)
    pdf.ts               per-page PDF text extraction (unpdf, pure JS)
  features/
    extract/             scan · cut · extract · schemas · prompts  → produces data/rules.json
    check/               check · checker-eval · schemas · prompts  → consumes data/rules.json
data/                    committed: rules.json, scan.json, subset.md (rest gitignored)
evaluations/
  extraction-eval/       golden_rules.json — reference ruleset for the extract stage
  checker-eval/          cases/*.txt + expected.json + validate.mjs — for the check stage
README.md                design-decisions narrative
```

The `Rule`/`RuleSet` schema in `src/features/extract/schemas.ts` is the **contract** between the two
features: extract produces it, check consumes it (re-exported from `src/features/check/schemas.ts`).

## How to work in this repo

- **Prompts are the graded artifact.** Behavioural changes belong in `src/features/*/prompts.ts`,
  then get re-validated against the golden set — not patched around in code. Rule of thumb from the
  build: *fix the rulebook, not the referee* (a wrong verdict is usually a missing/weak rule, not a
  checker-prompt problem).
- **Every LLM call is structured.** Use `structuredCall()` with a zod schema (`src/core/llm.ts`);
  responses are guaranteed valid JSON. Add/adjust schemas in the feature's `schemas.ts`.
- **Code owns the guarantees.** The check stage computes the PASS/WARN/FAIL band, enforces
  one-verdict-per-rule completeness, and verifies quoted evidence is a verbatim substring — all in
  `src/features/check/check.ts`. Keep these in code; the model only judges.
- **Generic by design.** No hardcoded industry/domain or page ranges in prompts — the document
  defines its own domain. Don't reintroduce document-specific vocabulary.
- **No orchestration framework.** Plain, linear pipeline on the raw OpenAI SDK. Keep it that way.

## Gotchas

- **Paid vs free.** `extract`, `check`, and `eval:checker` make real API calls (need a key, cost
  tokens). `typecheck` does not. Don't run the paid commands unprompted — ask first.
- **The extractor is non-deterministic.** Re-running `extract` regenerates a different taxonomy,
  rule count, and IDs. That's why the evals are **ID-free** — they anchor to stable surfaces (the
  band and verbatim phrases from the text), never rule IDs. Don't pin evals to rule IDs.
- **`check` reads the committed `data/rules.json`** by default; re-running `extract` will change it.
- **Verify before finishing:** run `npm run typecheck` for any code change; use `npm run eval:checker`
  (paid) to sanity-check the checker.
