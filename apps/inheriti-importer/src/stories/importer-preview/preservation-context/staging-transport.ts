import {
  ElectronHttpTransport,
  type HttpRequestLike,
  type HttpResponseLike,
} from '@modules/_shared/infrastructure/transport/electron-http-transport';
import type { WrappedFieldValue } from '@modules/batch/infrastructure/importer-tool-repo';
import type { PlanBatchEntry } from '@modules/batch/domain/plan-batch-input';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import manifest from '../../../../tests/fixtures/sample-imports/realistic/manifest.json';

const syntheticKeyBytes = new Uint8Array(32).fill(0xa5);
export const syntheticKey = 'a5'.repeat(32);
export const organizationId = 'synthetic-organization';
export const memberId = 'synthetic-member';

type Write = {
  id: string;
  planDraft: Record<string, unknown>;
  assetDrafts: {
    id: string;
    type: string;
    title: string;
    fields: { fieldId: string; envelope: WrappedFieldValue }[];
  }[];
};

export class StagingTransport extends ElectronHttpTransport {
  readonly writes = new Map<string, Write>();
  readonly failures = new Set<string>();
  attempts = 0;
  failSecond = true;

  override async request<T>(request: HttpRequestLike): Promise<HttpResponseLike<T>> {
    const respond = (status: number, body: unknown) => ({ status, body: body as T });
    const endpoint = `/integrations/v1/organizations/${organizationId}/importer-tool/staged-items`;
    if (request.method === 'GET' && request.path.startsWith(`${endpoint}/`))
      return this.writes.has(request.path.slice(endpoint.length + 1))
        ? respond(200, {})
        : respond(400, { error: 'staged_item_not_found' });
    check(
      request.method === 'POST' && request.path === endpoint,
      'Unexpected local staging request',
    );
    const body = request.body as Write;
    check(!this.writes.has(body.id), 'A completed staged plan was submitted twice');
    this.attempts += 1;
    if (this.failSecond && this.attempts === 2) {
      this.failures.add(body.id);
      return respond(503, { error: 'synthetic_write_failure' });
    }
    this.writes.set(body.id, body);
    return respond(200, { result: { id: body.id, expiresAt: '2099-01-01T00:00:00.000Z' } });
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function auditStaged(
  transport: StagingTransport,
  entries: readonly PlanBatchEntry[],
  session: ImportSession,
  coverage: SourceCoverage,
) {
  check(coverage.ready, 'Unresolved source fields reached staging');
  check(transport.writes.size === entries.length, 'Staged plan total differs from batch total');
  check(
    [...transport.failures].every((id) => transport.writes.has(id)),
    'Retry changed staged item ID',
  );
  const key = await crypto.subtle.importKey('raw', syntheticKeyBytes, 'AES-GCM', false, [
    'decrypt',
  ]);
  const body = JSON.stringify([...transport.writes.values()]);
  const destinations = new Map<string, Map<string, string>>();
  let envelopes = 0;
  for (const entry of entries) {
    const plan = entry.input.plan;
    const write = transport.writes.get(entry.planId);
    check(write && write.planDraft.name === plan.name, 'Staged plan identity mismatch');
    const { assets: _plaintextAssets, ...expectedPlanDraft } = entry.input.payload;
    check(
      JSON.stringify(write.planDraft) === JSON.stringify(expectedPlanDraft),
      'Plan metadata differs from the allowed plaintext draft',
    );
    check(
      Object.keys(write).sort().join(',') === 'assetDrafts,id,planDraft,ttlHours',
      'Staging request contains unexpected properties',
    );
    check(write.assetDrafts.length === plan.assets.length, 'Staged asset count mismatch');
    for (const [index, draft] of plan.assets.entries()) {
      const asset = write.assetDrafts[index]!;
      check(
        asset.type === draft.type && asset.title === draft.name,
        'Staged asset identity mismatch',
      );
      check(
        Object.keys(asset).sort().join(',') === 'fields,id,title,type',
        'Staged asset contains unexpected properties',
      );
      check(!destinations.has(draft.id), 'Draft asset was staged twice');
      const fields = new Map<string, string>();
      for (const field of asset.fields) {
        const { fieldId, envelope } = field;
        const context = {
          schemaVersion: 2,
          organizationId,
          memberId,
          stagedItemId: write.id,
          assetId: asset.id,
          fieldId,
        };
        check(
          Object.keys(envelope).sort().join(',') === 'algorithm,ciphertext,context,iv' &&
            Object.keys(field).sort().join(',') === 'envelope,fieldId',
          'Staged field contains unexpected plaintext properties',
        );
        check(
          envelope.algorithm === 'AES-GCM-256' &&
            JSON.stringify(envelope.context) === JSON.stringify(context),
          'Invalid encrypted binding context',
        );
        const decode = (value: string) =>
          Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
        const plaintext = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: decode(envelope.iv),
            additionalData: new TextEncoder().encode(JSON.stringify(context)),
          },
          key,
          decode(envelope.ciphertext),
        );
        check(!fields.has(fieldId), 'Duplicate staged field');
        fields.set(fieldId, new TextDecoder().decode(plaintext));
        envelopes += 1;
      }
      destinations.set(draft.id, fields);
      for (const [fieldId, binding] of Object.entries(draft.fieldBindings)) {
        const resolve = (id: string) => session.fieldsById[id]!.value.reveal();
        const expected =
          binding.kind === 'literal'
            ? binding.value.reveal()
            : binding.kind === 'source'
              ? resolve(binding.sourceFieldId)
              : binding.sources
                  .map((field) => `${field.name}: ${resolve(field.sourceFieldId)}`)
                  .join('\n');
        if (fieldId === 'secret.words') {
          check(
            expected
              .split(/\s+/)
              .filter(Boolean)
              .every((word, index) => fields.get(`${fieldId}.${index}`) === word),
            'Encrypted seed words differ from source',
          );
        } else {
          check(
            fields.get(fieldId) === expected,
            'Encrypted field differs from its source binding',
          );
        }
      }
    }
  }
  for (const field of coverage.fields) {
    if (field.status === 'excluded') {
      check(field.destinations.length === 0, 'Excluded field still has a draft destination');
      continue;
    }
    check(
      field.destinations.some(({ assetId, fieldId }) => {
        const staged = destinations.get(assetId);
        return (
          staged?.has(fieldId) ||
          [...(staged?.keys() ?? [])].some((key) => key.startsWith(`${fieldId}.`))
        );
      }),
      'Source coverage claims a missing encrypted destination',
    );
  }

  const richChecks = manifest.files['onepassword-rich.1pux'].checks;
  const checkedFields = await Promise.all(
    richChecks.map(async (expected) => {
      const node = Object.values(session.nodesById).find((entry) => entry.name === expected.title);
      check(node, 'Manifest entry is missing');
      const field = coverage.fields.find(
        (field) =>
          field.nodeId === node.id &&
          (field.name === expected.field || field.name === `extra:${expected.field}`),
      );
      check(field, 'Manifest source field is missing from coverage');
      const value = session.fieldsById[field.id]!.value.reveal();
      check(
        (await sha256(new TextEncoder().encode(value))) === expected.sha256,
        'Manifest source hash differs',
      );
      if (value.length >= 12)
        check(
          !body.includes(value) && !body.includes(JSON.stringify(value).slice(1, -1)),
          'Fixture value leaked into an encrypted staging request',
        );
      return {
        hash: expected.sha256,
        status: field.status,
        paths: field.destinations.map((entry) => entry.fieldId),
      };
    }),
  );
  return { envelopes, checkedFields, writes: transport.writes.size, attempts: transport.attempts };
}
