# Design decisions (my version)

My own account of how I approached the task and why — the human narrative behind the
decisions. The AI-generated running log lives in [DECISIONS.md](DECISIONS.md); this is the
version in my own words.

## Decisions

**D1 — Two commitments from the start: a closed evaluation loop, and a generic solution.**
Before writing any pipeline code I fixed two things in my head that everything else would have
to serve:

1. *A closed loop of evaluation.* I needed an independent yardstick to measure every version of
   my extraction against. So I asked AI to generate a result structure (the schema) for the
   policies/rules, and then — in a **separate session** — asked Opus to extract the policies from
   the document on its own, with no constraints or pipeline in the way. That unconstrained
   extraction became my **golden dataset**: a strong-model reference I could hold my own pipeline
   up against and ask "does this reach the same accuracy?"

2. *Generic from the start, no overfitting.* The golden set was built independently and the
   solution had to stay generic — it must work on different kinds of documents, not just this
   one. Keeping the golden reference separate from the pipeline is what stops me tuning my prompts
   *to the one document* instead of to the general problem. Every optimization is judged against
   that external set, so genericity is enforced by construction, not by good intentions.

This iterate-and-compare pattern is the engine I reuse throughout: later, for prompt
improvement, an agent iterates on a prompt and compares its output to the golden set on each
pass. The golden set is the fixed point; everything else moves toward it.

**D2 — Cutting the scope: scan → cut → extract, with recall guaranteed by construction.**
When I actually read the document, it was mostly unrelated content — sections that have nothing
to do with what I needed to extract. My first instinct was to look at just the first ~10 pages
to work out what's worth extracting from. That made it clear I needed a real way to **cut the
scope** before extraction rather than feed the whole document in.

My first version of that cut was a **planner** that read the document's table of contents and
picked the relevant sections. It had a structural blind spot: it can only choose what the
contents page actually lists — and in this document the binding rules live in a ~70-page legal
appendix the TOC never paginates. That cost me a real recall miss: a whole class of rules was
simply invisible to a TOC-based planner.

So I replaced it. **scan** sweeps *every page* of the document past the LLM (in windows) and asks,
per page, "is this checkable against a marketing text?". Recall is now guaranteed by construction
— no page can be invisible — and the prompt is deliberately **recall-biased**: when unsure,
include the page, because a false positive costs a few extraction tokens while a false negative
loses a rule. A deterministic **cut** then slices the marked pages into a subset, and **extract**
runs only on that.

**D3 — Considered: extract policies inside the scan phase (deferred as future work).**
Another layer I thought about was extracting the policies directly during the scan phase — since
scan already reads every page, why not have it emit rules as it goes? The catch is that this
would produce **duplicate policies**: the same obligation shows up in more than one place, so a
page-by-page extraction would emit it repeatedly, and I'd then need a **separate call to resolve
those duplicates**. Since my current scan → cut → extract approach already gives good results and
this is a demo, I decided not to build that and marked it as a future experiment instead.

**D4 — Prompts written by agents, not hand-tuned by me — kept honest by the eval loop.**
From the start I knew I wouldn't have time to review every prompt carefully by hand. So instead
of writing them myself, I had agents craft and refine the prompts, grounded on two things: the
**grilling session** (where the design was stress-tested) and the **evaluations against the
strong-model golden set** (D1). Those two guardrails are what let me get good results *without*
being actively in the loop on every prompt word — the golden set catches regressions, so the
agent can iterate freely. On top of that, I ran a **separate agent session whose only job was to
hunt for anything overfitted to this specific document** and flag it, so the solution stays
generic rather than quietly tuned to PS22/9.

**D5 — Single-call extraction is a benefit of the approach.**
Because scan → cut already shrinks the document to a scoped subset (~20–25 pages), the whole
subset fits one context window and extraction runs as a **single call** — the model sees all the
rules at once and dedupes them itself, instead of a parallel per-chunk pass that would
reintroduce a cross-chunk merge problem for zero benefit at this size. `extract` guards on token
count; the parallel map-reduce path is documented but not built (timebox cut).

**D6 — The checker feature was grilled with AI, then crafted inside its own eval loop.**
I designed the check stage the same way as the rest: a grilling session with AI where I mostly
followed its suggestions on the domain-specific choices (verdict types, a strict `needs_review`
definition, the deterministic PASS/WARN/FAIL band computed in code, verbatim evidence with a
code-side substring check). The key move was building a **new evaluation set for the checker
part** — once that existed, I could let AI craft and refine this feature inside the same closed
evaluation loop (D1), iterating against the checker golden set instead of me hand-tuning it.

A couple of insights the loop surfaced during those improvement iterations, as examples:

- *The rulebook beats the referee.* The checker kept flip-flopping on an unverifiable claim
  ("trusted by 30M users") no matter how much we strengthened the checker prompt. Root cause: no
  extracted rule mentioned substantiation, so the model was *correctly* applying the rule and
  ignoring our checker-side instructions. The fix belonged in the extractor (encode the
  substantiation duty), not the checker — fix the rulebook, not the referee.
- *The substantiation class needs a boundary.* A first version sent every factual claim to
  review, so a clean ad got flagged over its own "$10 minimum". The line: market/performance
  claims (user counts, rankings, returns, awards) need substantiation; the firm's own product
  terms (fees, minimums, range) are presumed accurate and judged on presentation only.

**D7 — The trust boundary: code owns the guarantees, the LLM only judges.**
A principle I held for the check stage: the model is allowed to make *judgments*, but never to own
the *guarantees*. Everything that has to be reliable is computed deterministically in code around
it. Concretely — the model returns a per-rule verdict, but:

- the overall **PASS/WARN/FAIL band** is computed in code from the verdict counts (any high-severity
  breach = FAIL), never invented by the model;
- **completeness** is enforced as a hard error: exactly one verdict per rule, or the run fails;
- **evidence honesty** is verified in code — a quoted breach must appear as a verbatim substring of
  the input text, so the model can't cite something it made up;
- the process exits with proper **CI exit codes** off the deterministic band, not off model prose.

So the split is clean: determinism and correctness live in code; only the judgment call lives in
the model.

**D8 — No orchestration framework: raw SDK + structured outputs.**
I deliberately used no orchestration framework (LangChain and friends) — just the raw OpenAI SDK.
Two reasons. First, the brief grades prompts over framework choice, so I wanted every prompt and
every call plainly visible rather than buried behind an abstraction. Second, it's a
simplification that fits the design: the whole workflow is **deterministic and linear** (scan →
cut → extract → check) — there's no agent making dynamic decisions at runtime, so there's nothing
for a framework to orchestrate. On top of that, zod **structured outputs** guarantee valid JSON at
every LLM boundary, so I never parse free-form model text.

**D9 — Last step: manual end-to-end verification.**
As the final step I verified the whole thing working end to end myself — ran the pipeline through,
read the code, made a few small adjustments and refactorings, and that was it.

## Implementation notes

- **Printed page numbers ≠ PDF page indices.** The TOC cites *printed* page numbers, but the PDF
  index is offset by the cover/contents pages. Fix: every page fed to the planner is prefixed with
  a `=== PDF PAGE n ===` marker and the planner is told to return PDF indices, not printed
  numbers; `cut` then slices exactly what the planner named. (One of the small things that
  surprised me.)
