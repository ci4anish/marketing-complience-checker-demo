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
