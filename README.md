## The short version

**What I built.** A four-stage pipeline — **scan → cut → extract → check** — that turns a
regulation PDF into a set of concrete, checkable rules, and then audits a piece of marketing text
against those rules (PASS / WARN / FAIL, with evidence for every finding).

**How I worked.** Before writing any pipeline code, I used a strong model to build an independent
"golden" answer set, and treated it as a fixed yardstick. From there I let AI draft and refine the
prompts, and judged every change against that yardstick instead of hand-tuning things myself. Two
rules kept the work honest throughout:

- **Keep it generic** — never tune to this one document; it should work on other regulations too.
- **Keep the guarantees in code** — the model is allowed to *judge*, but the code decides anything
that has to be reliable.

The decisions below are just this story in more detail.

## Quick start

**Requirements:** Node ≥ 24.

```bash
npm install
cp .env.example .env      # then set OPENAI_API_KEY (optional: OPENAI_MODEL, default gpt-5.1)
```

**Check a marketing text** — works out of the box against the committed `data/rules.json`:

```bash
npm run check -- --input path/to/ad.txt     # or:  echo "Get rich fast 🚀" | npm run check -- --input -
```

Prints a PASS / WARN / FAIL verdict with per-rule findings and quoted evidence, and writes the full
report to `data/report.json`. Exit code is non-zero on FAIL (CI-friendly).

**Rebuild the rulebook from a regulation PDF** — regenerates `data/rules.json` (runs scan → cut →
decompose):

```bash
npm run extract -- --pdf path/to/regulation.pdf
```

The FCA source PDF isn't committed; drop it at `.temp/regulations.pdf` or pass `--pdf`. `check`
needs no PDF — the committed `data/` artifacts keep it runnable on their own.

Full command reference and contributor/agent notes: **[AGENTS.md](AGENTS.md)**.

## Decisions

**D1 — Two commitments from the start: a closed evaluation loop, and a generic solution.**
*Takeaway: an independent golden set is my yardstick, so nothing gets tuned to a single document.*

Before writing any pipeline code I fixed two things in my head that everything else would have to
serve:

1. *A closed loop of evaluation.* I needed an independent way to measure every version of my
  extraction. So I asked AI to generate a result structure (the schema) for the policies/rules,
   and then — in a **separate session** — asked Opus to extract the policies from the document on
   its own, with no constraints or pipeline in the way. That unconstrained extraction became my
   **golden dataset**: a strong-model reference I could hold my own pipeline up against and ask
   "does this reach the same accuracy?"
2. *Generic from the start, no overfitting.* The golden set was built independently and the
  solution had to stay generic — it must work on different kinds of documents, not just this one.
   Keeping the golden reference separate from the pipeline is what stops me tuning my prompts *to
   the one document* instead of to the general problem. Every change is judged against that outside
   set, so the design stays general by default rather than by willpower.

This iterate-and-compare pattern is the engine I reuse throughout: later, for prompt improvement,
an agent iterates on a prompt and compares its output to the golden set on each pass. The golden
set is the fixed point; everything else moves toward it.

**D2 — Cutting the scope: scan → cut → extract, so no rule can be missed.**
*Takeaway: every page is read by the model, so nothing can slip past unseen.*

When I actually read the document, it was mostly unrelated content — sections that have nothing to
do with what I needed to extract. My first instinct was to look at just the first ~10 pages to
work out what's worth extracting from. That made it clear I needed a real way to **cut the scope**
before extraction rather than feed the whole document in.

My first version of that cut was a **planner** that read the document's table of contents and
picked the relevant sections. It had a blind spot: it can only choose what the contents page
actually lists — and in this document the binding rules live in a ~70-page legal appendix the
table of contents never lists by page. That cost me a real miss: a whole class of rules was simply
invisible to a contents-based planner.

So I replaced it. **scan** reads *every page* of the document (in windows) and asks, page by page,
"is this checkable against a marketing text?". Now nothing can be missed — every page is seen at
least once — and the prompt leans toward **including** rather than excluding: when unsure, keep the
page, because a wrongly-kept page only costs a few extra tokens later, while a wrongly-dropped page
loses a rule. A deterministic **cut** then slices the marked pages into a subset, and **extract**
runs only on that.

**D3 — Prompts written by agents, not hand-tuned by me — kept honest by the eval loop.**
*Takeaway: I let AI write the prompts; the eval loop, not me, kept them honest.*

From the start I knew I wouldn't have time to review every prompt carefully by hand. So instead of
writing them myself, I had agents craft and refine the prompts, grounded on two things: the
**grilling session** (where the design was stress-tested) and the **evaluations against the
strong-model golden set** (D1). Those two guardrails are what let me get good results *without*
being in the loop on every prompt word — the golden set catches regressions, so the agent can
iterate freely. On top of that, I ran a **separate agent session whose only job was to hunt for
anything overfitted to this specific document** and flag it, so the solution stays generic rather
than quietly tuned to this one paper.

**D4 — Single-call extraction is a benefit of the approach.**
*Takeaway: the scope is small enough to extract in one pass, which avoids duplicates for free.*

Because scan → cut already shrinks the document to a small subset (~20–25 pages), the whole subset
fits in one context window and extraction runs as a **single call** — the model sees all the rules
at once and removes duplicates itself. The alternative (extracting chunk-by-chunk in parallel)
would force me to merge and de-duplicate across chunks afterwards, for no benefit at this size.
`extract` checks the token count and, if a future document is ever too big, points to the
parallel path — which is documented but not built (cut for time).

**D5 — The checker feature was grilled with AI, then crafted inside its own eval loop.**
*Takeaway: I built a second golden set for the checking stage, then improved the judge against it
instead of by hand.*

I designed the check stage the same way as the rest: a grilling session with AI where I mostly
followed its suggestions on the domain-specific choices (verdict types, a strict `needs_review`
definition, the PASS/WARN/FAIL band computed in code, verbatim evidence with a code-side check).
The key move was building a **new evaluation set for the checker part** — once that existed, I
could let AI craft and refine this stage inside the same closed loop (D1), iterating against the
checker golden set instead of me hand-tuning it.

A couple of insights the loop surfaced during those iterations, as examples:

- *The rulebook beats the referee.* The checker kept flip-flopping on an unverifiable claim
("trusted by 30M users") no matter how much we strengthened the checker prompt. The real cause:
no extracted rule mentioned substantiation, so the model was *correctly* applying the rules and
ignoring our checker-side instructions. The fix belonged in the extractor (add the
substantiation rule), not the checker — fix the rulebook, not the referee.
- *The substantiation rule needs a boundary.* A first version sent every factual claim to review,
so a clean ad got flagged over its own "$10 minimum". The line I drew: outward claims (user
counts, rankings, returns, awards) need substantiation; the firm's own product terms (fees,
minimums, range) are presumed accurate and judged only on how they're presented.

**D6 — Code owns the guarantees; the model only judges.**
*Takeaway: the model gives opinions; the code decides anything that has to be reliable.*

A principle I held for the check stage: the model is allowed to make *judgments*, but never to own
the *guarantees*. Everything that has to be reliable is computed in code around it. The model
returns a per-rule verdict, but:

- the overall **PASS/WARN/FAIL result** is computed in code from the verdict counts (any
high-severity breach = FAIL), never decided by the model;
- **completeness** is enforced as a hard error: exactly one verdict per rule, or the run fails;
- **evidence is checked** in code — a quoted breach must actually appear word-for-word in the input
text, so the model can't cite something it made up;
- the program exits with proper **CI exit codes** based on that computed result, not on model prose.

So the split is clean: correctness lives in code; only the judgment call lives in the model.

**D7 — No orchestration framework: raw SDK + guaranteed-valid output.**
*Takeaway: a plain, linear pipeline needs no framework and no agent.*

I deliberately used no orchestration framework (LangChain and friends) — just the raw OpenAI SDK.
Two reasons. First, the task grades prompts over framework choice, so I wanted every prompt and
every call plainly visible rather than hidden behind an abstraction. Second, it fits the design:
the whole workflow is **fixed and linear** (scan → cut → extract → check) — there's no agent making
decisions at runtime, so there's nothing for a framework to orchestrate. On top of that, I use the
SDK's **structured outputs** (zod schemas) so every model response is guaranteed to be valid JSON —
I never parse free-form text.

**D8 — Last step: manual end-to-end verification.**
*Takeaway: I ran and read the whole thing myself before calling it done.*

As the final step I verified the whole thing working end to end myself — ran the pipeline through, read the code, made a few small adjustments and refactorings, improved the presantation, and that was it.

## What I'd do next

- **Extract while scanning.** Since scan already reads every page, it could emit rules as it goes —
one pass instead of two. I didn't build it because the same rule appears in several places, so
I'd get duplicates and need a separate step to merge them away; the current two-step approach
already works well for a demo. Marked as a future experiment.
- **Prove it on a second, non-finance document.** Everything is designed to be generic, but I've
only run it end-to-end on the one FCA document. The real test of that genericity is a different
regulation in a different domain — that's the top thing I'd do with more time.



## Implementation notes

- **Printed page numbers ≠ PDF page indices.** The table of contents cites *printed* page numbers,
but the PDF's own page order is offset by the cover/contents pages. Fix: every page fed to the
model is prefixed with a `=== PDF PAGE n ===` marker and the model is told to return PDF indices,
not printed numbers; `cut` then slices exactly the pages it named. (One of the small things that
surprised me.)

