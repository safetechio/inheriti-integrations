import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import { initialVaultState } from '@modules/import/infrastructure/stores/vault-store';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { allFieldsAsPlainText } from '@modules/mapping/application/suggestion-engine';
import { sourceSuggestions, statusKey, mappedFieldIds } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';
import { projectImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-projection';
import { getAssetReviewIssues } from '@modules/importer-preview/AssetReviewQueue/asset-review-issues';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';

const directory = resolve(process.cwd(), 'tests/fixtures/sample-imports/realistic');

async function loadFixture(fileName: string) {
  const data = Uint8Array.from(readFileSync(resolve(directory, fileName))).buffer;
  const parsed = await parseVaultFile(data, fileName);
  const sourceId = `passbolt:${fileName}`;
  const session = importSessionFromVaultState({
    ...initialVaultState,
    vaults: [{ id: sourceId, name: parsed.name, kind: parsed.kind, fileName, importedAt: '', diagnostics: parsed.diagnostics }],
    entries: parsed.entries.map((entry) => {
      const current = { ...entry, sourceId };
      return { current, original: current };
    }),
  });
  return { parsed, session };
}

function issueSnapshot(projection: ReturnType<typeof projectImporterWorkspace>) {
  return new Map(
    projection.assets.map((asset) => [
      asset.id,
      getAssetReviewIssues(
        asset,
        projection.coverage.fields,
        projection.assets.filter(({ id }) => id !== asset.id),
        projection.coverage.diagnostics,
      ),
    ]),
  );
}

function noteChoices(session: Awaited<ReturnType<typeof loadFixture>>['session']) {
  return {
    entryNotes: Object.fromEntries(
      Object.keys(session.nodesById).map((nodeId) => [nodeId, 'asset-notes' as const]),
    ),
  };
}

function resolveAllFields(session: Awaited<ReturnType<typeof loadFixture>>['session']) {
  const found = sourceSuggestions(session);
  const assets: Record<string, SuggestedAsset> = {};
  const owners: Record<string, string> = {};
  for (const node of Object.values(session.nodesById)) {
    const primary = found.find((asset) => asset.fromNodeId === node.id && !asset.variant);
    if (!primary) continue;
    const mapped = mappedFieldIds(primary);
    const fields = node.fieldIds
      .map((id) => session.fieldsById[id])
      .filter((field) => field && !mapped.has(field.id) && field.name !== 'notes');
    if (!fields.length) continue;
    const id = `${node.id}:PLAIN-TEXT-ADDITIONAL`;
    const companion = {
      ...allFieldsAsPlainText(session, node, fields),
      id,
      name: `${node.name} — additional fields`,
      variant: 'additional-fields' as const,
    };
    assets[id] = companion;
    fields.forEach((field) => { owners[field.id] = id; });
  }
  return { assets, owners };
}

describe('Passbolt fixture review status', () => {
  it.each(['passbolt-compatible.json', 'passbolt-export.csv'])(
    'keeps actionable undecided assets in Needs review and resolves notes separately for %s',
    async (fileName) => {
      const { session } = await loadFixture(fileName);
      const initial = projectImporterWorkspace(session, createEmptyWorkspace());
      const initialIssues = issueSnapshot(initial);
      const actionable = initial.assets.filter((asset) => {
        const issues = initialIssues.get(asset.id);
        return asset.status !== 'accepted' && asset.status !== 'excluded' && (issues?.issueCount ?? 0) > 0;
      });
      expect(actionable.length, fileName).toBeGreaterThan(0);
      expect(actionable.every(({ status }) => status === 'needs-review'), fileName).toBe(true);

      const notes = projectImporterWorkspace(
        session,
        createEmptyWorkspace(),
        {}, {}, {}, new Set(), {}, noteChoices(session),
      );
      const notesIssues = issueSnapshot(notes);
      for (const asset of actionable) {
        const before = initialIssues.get(asset.id)!;
        const after = notesIssues.get(asset.id)!;
        expect(after.diagnostics.map(([key, diagnostic]) => [key, diagnostic.code, diagnostic.count])).toEqual(
          before.diagnostics.map(([key, diagnostic]) => [key, diagnostic.code, diagnostic.count]),
        );
        expect(after.unresolved.map(({ name }) => name)).toEqual(before.unresolved.map(({ name }) => name));
        expect(after.issueCount).toBe(before.issueCount - (before.notesPending ? 1 : 0));
        if (after.issueCount > 0) expect(notes.assets.find(({ id }) => id === asset.id)?.status).toBe('needs-review');
      }

      const resolved = projectImporterWorkspace(
        session,
        createEmptyWorkspace(),
        {}, {}, {}, new Set(), {}, noteChoices(session), resolveAllFields(session),
      );
      const resolvedIssues = issueSnapshot(resolved);
      for (const asset of resolved.assets) {
        const issues = resolvedIssues.get(asset.id)!;
        expect(issues.issueCount, `${fileName}/${asset.name}`).toBe(0);
        expect(asset.status).not.toBe('needs-review');
      }
    },
  );
});
