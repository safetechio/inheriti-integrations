#!/usr/bin/env python3
"""Train a local candidate-ID extractor adapter; input rows contain no secrets."""

import argparse
import json
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer


class CandidateLoraTraining:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=True)

    def examples(self) -> Dataset:
        rows = []
        truncated = 0
        for line in Path(self.args.train).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            messages = json.loads(line)["messages"]
            if [message["role"] for message in messages] != ["system", "user", "assistant"]:
                raise ValueError("Expected system, user, assistant messages")
            candidates = json.loads(messages[1]["content"])["candidates"]
            answer = json.loads(messages[2]["content"])
            assignments = answer.get("assignments")
            if set(answer) != {"assignments"} or not isinstance(assignments, list) \
                    or len(assignments) != len(candidates):
                raise ValueError("Invalid positional candidate response")
            if any(set(entry) != {"group", "role"} or not isinstance(entry["group"], str)
                   or not isinstance(entry["role"], str)
                   or (not entry["group"] and entry["role"] != "unknown")
                   for entry in assignments):
                raise ValueError("Invalid candidate assignment")
            prompt = self.tokenizer.apply_chat_template(
                messages[:2], tokenize=False, add_generation_prompt=True, enable_thinking=False
            )
            completion = messages[2]["content"] + self.tokenizer.eos_token
            if len(self.tokenizer.encode(prompt + completion)) > self.args.max_length:
                truncated += 1
                if self.args.steps == 1:
                    continue
            rows.append({"prompt": prompt, "completion": completion})
        if truncated and self.args.steps > 1:
            raise ValueError(f"{truncated} training examples exceed --max-length; use a complete context for training")
        if not rows:
            raise ValueError("No complete training examples fit --max-length")
        return Dataset.from_list(rows)

    def checkpoint(self) -> str | None:
        if self.args.resume_from_checkpoint != "latest":
            return self.args.resume_from_checkpoint
        checkpoints = list(Path(self.args.output).glob("checkpoint-*"))
        if not checkpoints:
            raise ValueError("No checkpoint found in --output")
        return str(max(checkpoints, key=lambda path: int(path.name.split("-")[-1])))

    def run(self) -> None:
        torch.set_num_threads(self.args.threads)
        dataset = self.examples()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16) if device == "cuda" else torch.float32
        if self.args.dtype != "auto":
            dtype = getattr(torch, self.args.dtype)
        quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                          bnb_4bit_compute_dtype=dtype) if self.args.quantized else None
        model = AutoModelForCausalLM.from_pretrained(
            self.args.model, dtype=dtype, low_cpu_mem_usage=True, local_files_only=True,
            **({"quantization_config": quantization, "device_map": device} if quantization else {})
        )
        model.config.use_cache = False
        layers = range(max(0, model.config.num_hidden_layers - self.args.last_layers), model.config.num_hidden_layers)
        targets = ([f"model.layers.{layer}.self_attn.{projection}"
                    for layer in layers for projection in ("q_proj", "v_proj")]
                   if self.args.last_layers else ["q_proj", "v_proj"])
        trainer = SFTTrainer(
            model=model,
            processing_class=self.tokenizer,
            train_dataset=dataset,
            peft_config=LoraConfig(
                r=4, lora_alpha=8, lora_dropout=0.0,
                target_modules=targets, task_type="CAUSAL_LM"
            ),
            args=SFTConfig(
                output_dir=self.args.output,
                use_cpu=device == "cpu",
                max_length=self.args.max_length,
                max_steps=self.args.steps,
                per_device_train_batch_size=1,
                gradient_accumulation_steps=1,
                gradient_checkpointing=not (self.args.quantized or self.args.last_layers),
                learning_rate=2e-4,
                logging_steps=1,
                save_strategy="steps" if self.args.steps > 1 else "no",
                save_steps=self.args.save_steps,
                save_total_limit=self.args.save_total_limit,
                report_to="none",
                dataloader_pin_memory=False,
                completion_only_loss=True,
            ),
        )
        trainer.train(resume_from_checkpoint=self.checkpoint())
        trainer.save_model(self.args.output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="/tmp/inheriti-qwen-base")
    parser.add_argument("--train", default="/tmp/inheriti-candidate-training/train.jsonl")
    parser.add_argument("--output", default="/tmp/inheriti-qwen-candidate-lora")
    parser.add_argument("--steps", type=int, default=1)
    parser.add_argument("--save-steps", type=int, default=10)
    parser.add_argument("--save-total-limit", type=int, default=10)
    parser.add_argument("--resume-from-checkpoint")
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--quantized", action="store_true", help="Use CPU bitsandbytes NF4 QLoRA")
    parser.add_argument("--last-layers", type=int, default=0, help="Adapt only the last N attention layers")
    parser.add_argument("--dtype", choices=["auto", "bfloat16", "float16", "float32"], default="auto")
    CandidateLoraTraining(parser.parse_args()).run()


if __name__ == "__main__":
    main()
