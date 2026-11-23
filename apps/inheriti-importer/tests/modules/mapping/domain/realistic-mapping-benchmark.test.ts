import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCorePlanAssetTypes } from '@modules/plans/domain/asset-metadata';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import { initialVaultState } from '@modules/import/infrastructure/stores/vault-store';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';
import { bindingSourceIds, suggestWithFallback } from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';

type ExpectedCase = {
  fixture: string;
  entrySelector: { name: string; index?: number };
  expectedAssets: Array<{ type: string; fields: Record<string, string[]> }>;
  expectedUnassigned: string[];
};

const directory = resolve(process.cwd(), 'tests/fixtures/sample-imports/realistic');
const expectations = JSON.parse(
  readFileSync(resolve(directory, 'mapping-expectations.json'), 'utf8'),
) as { cases: ExpectedCase[] };
const knownAssetTypes = new Set(getCorePlanAssetTypes());
const strategy = new FieldAliasSuggestionStrategy();

function namesForBinding(asset: SuggestedAsset, target: string, session: ReturnType<typeof importSessionFromVaultState>): string[] {
  const binding = asset.fieldBindings[target];
  if (!binding) return [];
  return bindingSourceIds(binding).map((id) => session.fieldsById[id]?.name ?? `missing:${id}`);
}

function parseAssetNames(asset: SuggestedAsset, session: ReturnType<typeof importSessionFromVaultState>) {
  return Object.fromEntries(
    Object.keys(asset.fieldBindings)
      .sort()
      .map((target) => [target, namesForBinding(asset, target, session)]),
  );
}

async function loadSession(fileName: string) {
  const data = Uint8Array.from(readFileSync(resolve(directory, fileName))).buffer;
  const parsed = await parseVaultFile(data, fileName);
  const sourceId = `realistic:${fileName}`;
  return {
    parsed,
    session: importSessionFromVaultState({
      ...initialVaultState,
      vaults: [{ id: sourceId, name: parsed.name, kind: parsed.kind, fileName, importedAt: '' }],
      entries: parsed.entries.map((entry) => {
        const current = { ...entry, sourceId };
        return { current, original: current };
      }),
    }),
  };
}

describe('realistic mapping golden benchmark', () => {
  it.each(expectations.cases)('$fixture / $entrySelector.name', async (golden) => {
    const { session } = await loadSession(golden.fixture);
    const candidates = Object.values(session.nodesById).filter(
      (node) => node.name === golden.entrySelector.name,
    );
    expect(candidates).toHaveLength(golden.entrySelector.index === undefined ? 1 : expect.any(Number));
    const node = candidates[golden.entrySelector.index ?? 0];
    expect(node?.kind).toBe('entry');
    if (!node) return;

    const suggestions = suggestWithFallback([strategy], {
      session,
      nodeIds: [node.id],
      knownAssetTypes,
    });
    const actual = suggestions.map((asset) => ({ type: asset.type, fields: parseAssetNames(asset, session) }));
    expect(actual).toEqual(golden.expectedAssets);

    const allSourceNames = node.fieldIds.map((id) => session.fieldsById[id]?.name).filter(Boolean) as string[];
    const assigned = suggestions.flatMap((asset) => Object.values(asset.fieldBindings).flatMap((binding) => bindingSourceIds(binding).map((id) => session.fieldsById[id]?.name).filter(Boolean)) as string[]);
    expect(new Set(suggestions.flatMap((asset) => Object.values(asset.fieldBindings).flatMap(bindingSourceIds))).size).toBe(assigned.length);
    expect(assigned).toEqual(
      expect.arrayContaining(golden.expectedAssets.flatMap((asset) => Object.values(asset.fields).flat())),
    );
    expect(allSourceNames.filter((name) => !assigned.includes(name))).toEqual(golden.expectedUnassigned);

    for (const asset of suggestions.filter(({ type }) => type !== 'PLAIN-TEXT')) {
      const materialized = materialiseAsset({ ...asset, id: asset.id ?? node.id }, session);
      expect(materialized.errors, `${golden.fixture}/${node.name}: ${asset.type}`).toEqual([]);
    }
  });

  it('keeps every realistic fixture entry field-accounted without requiring automatic mapping', async () => {
    const fixtures = [...new Set(expectations.cases.map(({ fixture }) => fixture))];
    for (const fixture of fixtures) {
      const { parsed, session } = await loadSession(fixture);
      expect(parsed.entries.length, fixture).toBeGreaterThan(0);
      for (const node of Object.values(session.nodesById)) {
        expect(node.fieldIds.length, `${fixture}/${node.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('reports aggregate benchmark counts without presenting them as accuracy', async () => {
    let expected = 0;
    let matched = 0;
    let structuredExpected = 0;
    let structuredMatched = 0;
    let fallbackExpected = 0;
    let fallbackMatched = 0;
    let falsePositive = 0;
    let unmatchedPreserved = 0;
    for (const golden of expectations.cases) {
      const { session } = await loadSession(golden.fixture);
      const node = Object.values(session.nodesById).find(({ name }) => name === golden.entrySelector.name);
      if (!node) continue;
      const actual = suggestWithFallback([strategy], { session, nodeIds: [node.id], knownAssetTypes });
      const expectedNames = golden.expectedAssets.flatMap((asset) => Object.values(asset.fields).flat());
      const structuredNames = golden.expectedAssets
        .filter((asset) => asset.type !== 'PLAIN-TEXT')
        .flatMap((asset) => Object.values(asset.fields).flat());
      const fallbackNames = golden.expectedAssets
        .filter((asset) => asset.type === 'PLAIN-TEXT')
        .flatMap((asset) => Object.values(asset.fields).flat());
      expected += expectedNames.length;
      structuredExpected += structuredNames.length;
      fallbackExpected += fallbackNames.length;
      const actualNames = actual.flatMap((asset) => Object.values(asset.fieldBindings).flatMap((binding) => bindingSourceIds(binding).map((id) => session.fieldsById[id]?.name)));
      matched += expectedNames.filter((name) => actualNames.includes(name)).length;
      structuredMatched += structuredNames.filter((name) => actualNames.includes(name)).length;
      fallbackMatched += fallbackNames.filter((name) => actualNames.includes(name)).length;
      falsePositive += actualNames.filter((name) => !expectedNames.includes(name as string)).length;
      unmatchedPreserved += golden.expectedUnassigned.length;
    }
    console.info('realistic mapping benchmark counts', {
      expected,
      matched,
      structuredExpected,
      structuredMatched,
      fallbackExpected,
      fallbackMatched,
      falsePositive,
      unmatchedPreserved,
    });
    expect(expected).toBeGreaterThan(0);
  });
});
