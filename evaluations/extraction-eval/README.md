# Evaluation baseline — golden rule set

`golden_rules.json` is a hand-curated **reference extraction** of FCA PS22/9 (Consumer
Duty), produced by a full-document human-in-the-loop read. It exists to evaluate the
automated `extract` pipeline: run the pipeline, then compare its `data/rules.json`
against this baseline to measure recall (did it find the obligations that matter?) and
precision (did it invent or restate non-checkable ones?).

It conforms to the same `RuleSet` / `Rule` schema as the pipeline output (`src/schemas.ts`),
so the two files are directly comparable field-by-field.

## Where the policies actually live (document map)

`regulations.pdf` is 161 PDF pages. Printed page numbers equal PDF page indices in the
front matter (cover=1, contents=2, Ch 1 Summary starts at PDF p.3), so no offset applies
to the narrative chapters. The document has two layers:

1. **Narrative chapters (PDF p.3–89)** — "respondents said… our response…" prose. These
   *explain* the obligations but are not the binding text. The marketing-relevant ones:
   - Ch 4 — The Consumer Principle (Principle 12) — PDF p.31–36
   - Ch 5 — The cross-cutting rules — PDF p.37–40
   - Ch 8 — The consumer understanding outcome — PDF p.50–55

2. **Appendix 1 — "Made rules (legal instrument)" = the Consumer Duty Instrument 2022
   (FCA 2022/31)** — starts PDF p.93, 68 internal pages. This is the **binding rule text**
   and the authoritative source for extraction:
   - Annex A — Glossary amendments — from PDF p.95
   - **Annex B — Amendments to PRIN (Principles for Businesses)** — from PDF p.104:
     - **Principle 12** ("A firm must act to deliver good outcomes for retail customers") — PDF p.104
     - PRIN 2A.1 — Application and purpose — PDF p.104–107
     - **PRIN 2A.2 — Cross-cutting obligations** (good faith 2A.2.1–2.7; foreseeable harm
       2A.2.8–2.13; enable & support 2A.2.14–2.25) — PDF p.108–110
     - PRIN 2A.3 — Products & services outcome — PDF p.110+ *(out of scope)*
     - PRIN 2A.4 — Price & value outcome — PDF p.~120+ *(out of scope)*
     - **PRIN 2A.5 — Consumer understanding outcome** (2A.5.1–2A.5.15) — PDF p.125–131
     - PRIN 2A.6 — Consumer support outcome — PDF p.131+ *(out of scope)*

**Key point for the pipeline:** the strongest citations come from PRIN 2A, not the
narrative chapters. Each golden rule cites the PRIN 2A rule reference (e.g. `PRIN 2A.5.3R(2)`)
plus the explanatory chapter. If the pipeline only reads/cites the narrative chapters, its
rules will be softer and less checkable than they could be.

## Scope (what a marketing-text checker should extract)

The tool checks a **piece of marketing / consumer-communication text**. So the golden set
keeps only obligations that are *checkable against such a text*, across the three schema
categories:

| Category | Source | Golden rules |
|---|---|---|
| `consumer_principle` | Principle 12 | CP-01 |
| `cross_cutting` | PRIN 2A.2 | CC-01 good faith · CC-02 foreseeable harm · CC-03 enable/support objectives · CC-04 no exploitation of biases/vulnerability |
| `consumer_understanding` | PRIN 2A.5 | CU-01 clear/fair/not misleading · CU-02 support understanding/info needs · CU-03 balanced benefits vs risks (risk warning) · CU-04 plain language/jargon · CU-05 prominence / avoid unnecessary disclaimers · CU-06 appropriate level of detail · CU-07 timely · CU-08 tailor to audience/vulnerability/complexity |

**13 rules total.**

**Deliberately scoped out** (firm-process / back-office obligations that cannot be judged
from a static marketing text — see `scope_note` in the JSON): product governance & approval
(PRIN 2A.3), price & value assessment (PRIN 2A.4), consumer support channels (PRIN 2A.6),
firm-side testing/monitoring processes (PRIN 2A.5.10R–2A.5.13G), redress after harm
(PRIN 2A.2.5R), distribution-chain information/notification duties (PRIN 2A.5.14R–2A.5.15R),
one-to-one interactive tailoring (PRIN 2A.5.9R), governance (Ch 13), implementation
timetable (Ch 12).

## How to use this as an eval

1. Run `npm run plan → cut → extract` to produce `data/rules.json`.
2. Compare against `evaluations/extraction-eval/golden_rules.json`:
   - **Recall** — is there a pipeline rule matching each golden rule's *obligation*
     (match on meaning, not wording)? Missing a **high**-severity rule (CP-01, CC-01,
     CC-02, CC-04, CU-01, CU-02, CU-03) is the most serious failure mode.
   - **Checkability** — is each pipeline `check` a concrete yes/no question about a text,
     or just a restated paragraph? (This is the brief's core grading criterion.)
   - **Precision** — extras from scoped-out process areas aren't "wrong", but a good
     marketing-checker should concentrate here. Flag pure restatements and duplicates.
   - **Citations** — does the pipeline cite specific PRIN 2A references, or only vague
     chapter-level pointers?
3. Sanity anchor — the brief's own example, *"Install our app and get rich tomorrow 🚀🚀🚀"*,
   should fire on **CC-04** (urgency/excitement/greed manipulation), **CU-03** (no risk
   warning), **CU-01** (misleading return promise) and **CP-01** (not a good outcome). If
   the pipeline's rules can't collectively catch this, it has a recall gap.

## Caveats

- This baseline is one strong reviewer's judgment, not ground truth. Treat divergences as
  prompts for investigation, not automatic pipeline failures.
- Rule *granularity* is a judgment call: e.g. CU-01 (clear/fair/not misleading) and CU-03
  (balanced risk presentation) could be merged. Compare on obligations covered, not rule count.
- Page indices are for this exact `regulations.pdf`; re-verify if the file is replaced.
