# Candidate ID semantic training data

Build Core, then run `node packages/core/training/generate.mjs [output-directory]` from the repository root. It writes deterministic `train.jsonl` (708 examples) and `validation.jsonl` (36 examples). The default output directory is `packages/core/training/generated`; generated files are local artifacts and should not be committed. All examples are synthetic and contain only masked candidate IDs, public labels, and fictional service names. No real values or source references are present.

Each row has `id`, `language`, `category`, and `messages`. The messages contain the current built runtime `localPlanCandidatePrompt`, the candidate inference user JSON (`{ "text": "...", "candidates": [{ "id": "v0", "label": "..." }] }`), and the expected positional response. The answer has one `{ "group": "...", "role": "..." }` assignment per candidate, in candidate order. A candidate used only as plan metadata has `{"group":"","role":"unknown"}`. The model does not repeat asset values or infer plan metadata. The generator converts the existing semantic groups to this contract and checks the built runtime schema; rebuild Core after changing the contract.

Training contains English, Spanish, French, German, Portuguese, and Dutch examples. Its 708 rows follow the requested mix approximately: 264 clear prose (37.3%), 168 messy or ambiguous prose (23.7%), 96 `.env` (13.6%), 60 JSON/YAML (8.5%), 84 mixed prose and configuration (11.9%), and 36 negative cases with only ignored IDs (5.1%). New cases exercise multiple account blocks, email and URL values separated from a password, and an account beside host and private-key-path context. They use fictional service names and the same structural patterns in all six languages; language wording appears only in training examples, not runtime matching rules. The 36 validation rows use separate scenarios and service names. The nine manually written held-out cases use further distinct wording and services. The generator rejects repeated input text within or between generated splits.

Do not train on `evaluation/cases.jsonl` or `evaluation/heldout-cases.jsonl`. Evaluate predictions with `node packages/core/evaluation/evaluate.mjs predictions.jsonl packages/core/evaluation/heldout-cases.jsonl` after building Core. This generator prepares examples only; it does not train or modify a model.

`train_lora.py` is an offline development command. Install CPU PyTorch from its CPU wheel index on a CPU machine, or a CUDA-enabled PyTorch build on a CUDA machine, then install `requirements.txt`. Download the original `Qwen/Qwen3-1.7B` weights into a local directory. Run a one-step smoke check with `--steps 1`; set `--steps` explicitly for a longer experiment. The script trains only `q_proj` and `v_proj` LoRA matrices and saves an adapter. It detects CUDA and chooses a supported dtype automatically. `--last-layers N` can restrict the experiment to the last N attention layers. A one-step smoke run is not a trained model. The script does not change the CLI/MCP model or run while a user requests a suggestion.

```sh
python3 -m venv "$HOME/.inheriti/local-assistant/training/venv"
"$HOME/.inheriti/local-assistant/training/venv/bin/pip" install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
"$HOME/.inheriti/local-assistant/training/venv/bin/pip" install -r packages/core/training/requirements.txt
"$HOME/.inheriti/local-assistant/training/venv/bin/python" packages/core/training/train_lora.py \
  --model "$HOME/.inheriti/local-assistant/training/Qwen3-1.7B" \
  --train "$HOME/.inheriti/local-assistant/training/train.jsonl" \
  --output "$HOME/.inheriti/local-assistant/training/candidate-lora" --steps 1
```

The default context length is 512 tokens. The trainer checks each generated prompt and answer against the selected context length; a one-step smoke run skips examples that do not fit, while multi-step training rejects truncation. Compare an adapter on the held-out corpus before considering packaging it for inference. Existing checkpoints trained on the previous group-and-ID response contract are incompatible with these new examples; start a separate output directory for this contract.

For multi-step runs, the trainer keeps the ten latest checkpoints and saves every 10 steps by default. Use `--save-steps N` and `--save-total-limit N` to adjust retention. Use `--resume-from-checkpoint latest` with the same `--output` directory and a larger total `--steps` value to continue after an interruption.
