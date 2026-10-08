import { quickPlanAssetCatalog } from '@safetech/inheriti-elements-core/node';
import type { QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { trayMessages as messages } from '../../../messages.js';

export type CreateQuickPlanInput = { title: string; teamId?: string; asset: QuickPlanInput['asset'] };

export function parseQuickPlanInput(value: unknown): CreateQuickPlanInput {
  const request = asRecord(value);
  assertSize(request);
  const title = requiredText(request.title);
  const teamId = request.teamId === undefined ? undefined : requiredText(request.teamId);
  const asset = parseAsset(request.asset);
  return teamId === undefined ? { title, asset } : { title, teamId, asset };
}

function parseAsset(value: unknown): QuickPlanInput['asset'] {
  const input = asRecord(value);
  const meta = asRecord(input.meta);
  const secret = asRecord(input.secret);
  const definition = quickPlanAssetCatalog.find(({ id }) => id === input.type);
  if (!definition) throw invalidInput();

  const fields = definition.fields.concat(definition.category === 'MEDIA-FILES' ? ['fileName', 'fileSize'] : []);
  if (Object.keys(secret).some((field) => !fields.includes(field))) throw invalidInput();

  const parsedSecret: Record<string, string | string[] | number> = {};
  for (const field of fields) {
    if (!(field in secret)) continue;
    const value = secret[field];
    if (field === 'fileSize') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidInput();
      parsedSecret[field] = value;
      continue;
    }
    if (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))) {
      parsedSecret[field] = value;
      continue;
    }
    throw invalidInput();
  }

  return {
    type: definition.id as QuickPlanInput['asset']['type'],
    meta: parseMeta(meta),
    secret: parsedSecret as QuickPlanInput['asset']['secret'],
  };
}

function parseMeta(input: Record<string, unknown>): QuickPlanInput['asset']['meta'] {
  const meta: QuickPlanInput['asset']['meta'] = { name: requiredText(input.name) };
  if (typeof input.notes === 'string') meta.notes = input.notes;
  if (input.code !== undefined) {
    if (typeof input.code !== 'string') throw invalidInput();
    meta.code = input.code;
  }
  if (input.matchOrigins !== undefined) {
    if (!Array.isArray(input.matchOrigins) || !input.matchOrigins.every((origin) => typeof origin === 'string')) throw invalidInput();
    meta.matchOrigins = input.matchOrigins;
  }
  if (typeof input.mimeType === 'string') meta.mimeType = input.mimeType;
  if (typeof input.fileName === 'string') meta.fileName = input.fileName;
  if (input.isMedia === true) meta.isMedia = true;
  return meta;
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw invalidInput();
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidInput();
  return value as Record<string, unknown>;
}

function assertSize(value: Record<string, unknown>): void {
  try {
    if (JSON.stringify(value).length <= 25_000_000) return;
  } catch {}
  throw invalidInput();
}

function invalidInput(): Error {
  return new Error(messages.invalidQuickPlan);
}
