#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProtectionValueDetector } from '../dist/plan-suggestion/protection-value-detector.js';
import { LocalPlanAssistant } from '../dist/local-plan-assistant.js';
import { localPlanQuestions } from '../dist/local-plan-draft.js';

const cases = readFileSync(fileURLToPath(new URL('./raw-cases.jsonl', import.meta.url)), 'utf8').trim().split('\n').map(JSON.parse);
const detector = new ProtectionValueDetector();
let found = 0, total = 0, leaked = 0, modelNeeded = 0, deterministic = 0, exactAssets = 0;
for (const item of cases) {
  const source = { id: item.id, kind: 'message', text: item.text };
  const { candidates, modelSources } = detector.detect([source]);
  const spans = candidates.map(({ valueReference }) => 'start' in valueReference
    ? item.text.slice(valueReference.start, valueReference.end) : '');
  const recalled = item.values.filter((value) => spans.includes(value)).length;
  const masked = JSON.stringify(modelSources);
  const leaks = item.values.filter((value) => masked.includes(value)).length;
  let calls = 0, result;
  try {
    result = await new LocalPlanAssistant({ infer: async () => { calls++; return { questions: [localPlanQuestions[4]], unassignedSources: [item.id] }; } })
      .suggest([source], null, new AbortController().signal);
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  const assets = 'asset' in result ? result.assets ?? [result.asset] : [];
  const matches = item.assets ? assets.length === item.assets.length && item.assets.every((expected) => assets.some((asset) =>
    asset.type === expected.type && Object.entries(expected.fields).every(([field, value]) => {
      const ref = asset.fields[field];
      return ref && ref.sourceId === item.id && 'start' in ref && item.text.slice(ref.start, ref.end) === value;
    }))) : null;
  found += recalled; total += item.values.length; leaked += leaks; modelNeeded += Number(calls > 0);
  deterministic += Number(calls === 0 && assets.length > 0); exactAssets += Number(matches === true);
  process.stdout.write(`${item.id}: spans ${recalled}/${item.values.length}, leaks ${leaks}, model ${calls > 0 ? 'yes' : 'no'}, assets ${assets.length}${matches === null ? '' : `, exact ${matches}`}${'error' in result ? `, error ${result.error}` : ''}\n`);
}
process.stdout.write(`TOTAL: spans ${found}/${total}, leaks ${leaked}, model-needed ${modelNeeded}/${cases.length}, deterministic drafts ${deterministic}, exact annotated drafts ${exactAssets}/${cases.filter((item) => item.assets).length}\n`);
if (leaked) process.exitCode = 1;
