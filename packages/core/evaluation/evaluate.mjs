#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { candidateSemanticRoles } from '../dist/llama-plan-model-support.js';

const predictionPath = process.argv[2];
if (!predictionPath) {
  process.stderr.write('Usage: node evaluate.mjs predictions.jsonl [cases.jsonl]\n');
  process.exit(2);
}
const readJsonl = (path) => readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); }
  catch { throw new Error(`Invalid JSON at ${path}:${index + 1}`); }
});
const cases = readJsonl(process.argv[3] ?? new URL('./cases.jsonl', import.meta.url));
const predictions = new Map(readJsonl(predictionPath).map((row) => [row.caseId, row]));
const allowedRoles = new Set(candidateSemanticRoles);
const pairs = (assignments, ids) => {
  const result = new Set();
  for (let i = 0; i < assignments.length; i++) {
    if (!assignments[i]?.group) continue;
    for (let j = i + 1; j < assignments.length; j++) {
      if (assignments[i].group === assignments[j]?.group) result.add(`${ids[i]}|${ids[j]}`);
    }
  }
  return result;
};
const ratio = (part, whole) => whole ? part / whole : null;
const totals = { cases: cases.length, validSchema: 0, pairTruePositive: 0, pairPredicted: 0,
  pairExpected: 0, roleCorrect: 0, roleTotal: 0, ignoredCorrect: 0, ignoredTotal: 0,
  plaintextLeaks: 0, missingPredictions: 0 };
const details = [];
for (const item of cases) {
  const prediction = predictions.get(item.caseId);
  const output = prediction?.output;
  const ids = item.candidates.map(({ id }) => id);
  const assignments = Array.isArray(output?.assignments) ? output.assignments : [];
  const leaked = item.candidates.some(({ placeholder }) => JSON.stringify(output ?? '').includes(placeholder));
  const valid = output && typeof output === 'object' && !Array.isArray(output)
    && Object.keys(output).join(',') === 'assignments'
    && assignments.length === ids.length
    && assignments.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
      && Object.keys(entry).sort().join(',') === 'group,role'
      && typeof entry.group === 'string' && typeof entry.role === 'string'
      && (entry.group === '' ? entry.role === 'unknown' : allowedRoles.has(entry.role))) && !leaked;
  const expected = ids.map((id) => {
    const group = item.expected.groups.find((owner) => owner.fields.some((field) => field.valueId === id));
    return { group: group?.name ?? '', role: group?.fields.find((field) => field.valueId === id)?.role ?? '' };
  });
  const actualPairs = pairs(assignments, ids);
  const expectedPairs = pairs(expected, ids);
  const truePositive = [...actualPairs].filter((pair) => expectedPairs.has(pair)).length;
  const roleCorrect = expected.filter((entry, index) => entry.group
    && assignments[index]?.group && entry.role === assignments[index]?.role).length;
  const roleTotal = expected.filter((entry) => entry.group).length;
  const ignoredCorrect = expected.filter((entry, index) => !entry.group && assignments[index]?.group === '').length;
  const ignoredTotal = expected.filter((entry) => !entry.group).length;
  totals.validSchema += Number(valid);
  totals.pairTruePositive += truePositive;
  totals.pairPredicted += actualPairs.size;
  totals.pairExpected += expectedPairs.size;
  totals.roleCorrect += roleCorrect;
  totals.roleTotal += roleTotal;
  totals.ignoredCorrect += ignoredCorrect;
  totals.ignoredTotal += ignoredTotal;
  totals.plaintextLeaks += Number(leaked);
  totals.missingPredictions += Number(!prediction);
  details.push({ caseId: item.caseId, validSchema: Boolean(valid),
    roleCorrect, roleTotal, ignoredCorrect, ignoredTotal, plaintextLeak: leaked,
    pairTruePositive: truePositive, pairPredicted: actualPairs.size, pairExpected: expectedPairs.size });
}
const precision = ratio(totals.pairTruePositive, totals.pairPredicted) ?? (totals.pairExpected ? 0 : 1);
const recall = ratio(totals.pairTruePositive, totals.pairExpected) ?? 1;
process.stdout.write(`${JSON.stringify({ summary: {
  cases: totals.cases, validSchemaRate: ratio(totals.validSchema, totals.cases),
  groupingPairwiseF1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
  roleAccuracy: ratio(totals.roleCorrect, totals.roleTotal),
  ignoredAccuracy: ratio(totals.ignoredCorrect, totals.ignoredTotal),
  plaintextLeakCases: totals.plaintextLeaks, missingPredictions: totals.missingPredictions,
}, cases: details }, null, 2)}\n`);
