#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { LlamaPlanModel } from '../dist/llama-plan-model.js';

const [casesPath, outputPath, runtimePath, modelPath] = process.argv.slice(2);
if (!casesPath || !outputPath || !runtimePath || !modelPath) {
  process.stderr.write('Usage: node predict-local.mjs cases.jsonl predictions.jsonl llama-server model.gguf\n');
  process.exit(2);
}
const cases = readFileSync(casesPath, 'utf8').trim().split(/\r?\n/u).map((line) => JSON.parse(line));
const model = new LlamaPlanModel(runtimePath, modelPath);
const predictions = [];
try {
  for (const item of cases) {
    const started = Date.now();
    const output = await model.infer({
      sources: [{ id: item.caseId, kind: 'message', text: item.maskedSource }],
      candidates: item.candidates.map(({ id, label }) => ({ id, label })),
      allowedAssets: [], currentDraft: null,
    }, new AbortController().signal);
    predictions.push({ caseId: item.caseId, output });
    process.stderr.write(`${item.caseId}: ${Date.now() - started} ms\n`);
  }
} finally {
  model.stop();
}
writeFileSync(outputPath, `${predictions.map((item) => JSON.stringify(item)).join('\n')}\n`);
