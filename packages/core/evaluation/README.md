# Candidate semantic evaluation

`cases.jsonl` contains 21 hand-authored synthetic cases. Every candidate value is a placeholder. `maskedSource` is the text supplied to the model; `expected` records semantic grouping and roles. `heldout-cases.jsonl` adds nine cases that must stay out of training and validation.

Create one JSONL prediction per case. `assignments` has exactly one item per candidate, in the same order. Equal nonempty `group` strings place candidates in one asset; an ignored candidate uses `{"group":"","role":"unknown"}`. Plan metadata is reviewed separately:

```json
{"caseId":"en-account","output":{"assignments":[{"group":"GitHub","role":"username"},{"group":"GitHub","role":"password"}]}}
```

Build Core, then run `node packages/core/evaluation/evaluate.mjs predictions.jsonl [cases.jsonl]`. The evaluator reports schema validity, grouping pairwise F1, role accuracy on expected protected candidates, ignored-candidate accuracy, and placeholder leaks. Candidate IDs cannot be invented, duplicated, or omitted in a valid positional response; schema validity checks exact array length and roles instead.

The evaluator does not infer, download, train, or modify model files. The training generator and split are documented in `../training/README.md`.

## Raw input check

`raw-cases.jsonl` holds synthetic original messages in English, Dutch, Spanish, and a Unicode structural case, plus environment assignments, prose, SSH path, and ambiguous or malformed input. Each `values` item is an exact expected candidate value; `assets` is present only where deterministic grouping can be judged without a model. Run `pnpm --dir packages/core build && node packages/core/evaluation/run-raw.mjs` from the workspace root.

The runner reports exact candidate span recall, values left in model input, whether `suggest()` invoked a model, and exact type, field, and source-reference matches for annotated deterministic drafts. Its stub model supplies no semantic answer, so model-needed cases cannot be scored for final draft quality here. A zero leak count covers only the listed expected values, not arbitrary sensitive text; the cases contain no real credentials.
