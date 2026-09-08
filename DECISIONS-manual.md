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

**D2 — Cutting the scope: scan → cut → extract as separate steps.**
When I actually read the document, it was mostly unrelated content — sections that have nothing
to do with what I needed to extract. My first instinct was to look at just the first ~10 pages
to work out what's worth extracting from. That made it clear I needed a real way to **cut the
scope** before extraction rather than feed the whole document in. That's where the split into
separate steps came from: a **planner** that decides which parts of the document are relevant, a
deterministic **cut** that slices them out, and then **extract** that runs only on the reduced,
relevant subset.

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

## Implementation notes

- **Printed page numbers ≠ PDF page indices.** The TOC cites *printed* page numbers, but the PDF
  index is offset by the cover/contents pages. Fix: every page fed to the planner is prefixed with
  a `=== PDF PAGE n ===` marker and the planner is told to return PDF indices, not printed
  numbers; `cut` then slices exactly what the planner named. (One of the small things that
  surprised me.)
