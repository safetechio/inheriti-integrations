import { DEFAULT_IMPORT_LIMITS } from './import-guards';
import type { ExtraField, SourceFieldMetadata } from './vault';

type Path = Array<string | number>;

const maxDepth = 16;
const maxNodes = 512;
const maxUnits = 1024 * 1024;

export function isAutomaticallyMappable({ metadata }: { metadata?: SourceFieldMetadata }): boolean {
  const type = metadata?.sourceFieldType?.toLowerCase();
  return (
    metadata?.sourceAutoMapping !== 'manual-only' &&
    type !== 'base64' &&
    type !== 'opaque' &&
    type !== 'json'
  );
}

/** Structured values can be represented as text when number tokens are canonical safe integers. */
export function hasLosslessJsonNumbers(text: string): boolean {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (quoted && char === '\\') {
      index += 1;
    } else if (!quoted && (char === '-' || (char >= '0' && char <= '9'))) {
      const start = index;
      while (index + 1 < text.length && /[\d.eE+-]/.test(text[index + 1])) {
        index += 1;
        if (index - start >= 17) return false;
      }
      const token = text.slice(start, index + 1);
      const value = Number(token);
      if (!Number.isSafeInteger(value) || String(value) !== token) return false;
    }
  }
  return true;
}

function isHistoricalField(key: string, structured: boolean): boolean {
  return (
    /^(?:password|credential)[ _-]?history$/i.test(key) || (structured && /^history$/i.test(key))
  );
}

function readSourcePath(encodedPath: string | undefined, sourceKey: string): Path | undefined {
  if (encodedPath === undefined) return [sourceKey];
  if (encodedPath.length > maxUnits) return;
  try {
    const decoded: unknown = JSON.parse(encodedPath);
    if (
      Array.isArray(decoded) &&
      decoded.length &&
      decoded.every(
        (segment) => typeof segment === 'string' || (Number.isSafeInteger(segment) && segment >= 0),
      )
    )
      return decoded;
  } catch {
    return;
  }
}

/** Reserve each unprocessed field a slot so a failed expansion can retain its original value. */
export function expandStructuredExtraFields(fields: readonly ExtraField[]): ExtraField[] {
  const available = DEFAULT_IMPORT_LIMITS.maxFieldsPerEntry - 5 - fields.length;
  let extraSlots = Math.max(0, available);
  let remainingNodes = maxNodes;
  let remainingUnits = maxUnits;

  return fields.flatMap((field, index) => {
    if (field.metadata?.sourceAutoMapping === 'manual-only') return [field];
    const sourceKey = field.metadata?.sourceKey ?? field.key;
    const structured = field.metadata?.sourceFieldType === 'json';
    const fallback = (): ExtraField => ({
      ...field,
      metadata: { ...field.metadata, sourceAutoMapping: 'manual-only' },
    });
    if (isHistoricalField(sourceKey, structured)) return [fallback()];
    const encodedPath = field.metadata?.sourcePath;
    const originalPath = readSourcePath(encodedPath, sourceKey);
    if (
      !originalPath ||
      originalPath.some(
        (segment, index) =>
          typeof segment === 'string' &&
          isHistoricalField(segment, structured || index < originalPath.length - 1),
      )
    )
      return [fallback()];
    if (!structured) return [field];
    const units = field.value.length + (encodedPath?.length ?? 0);
    if (units > remainingUnits || !remainingNodes) return [fallback()];
    remainingUnits -= units;

    let value: unknown;
    try {
      if (!hasLosslessJsonNumbers(field.value)) return [fallback()];
      value = JSON.parse(field.value);
    } catch {
      return [fallback()];
    }
    if (value === null || typeof value !== 'object') return [fallback()];

    const leaves: ExtraField[] = [];
    const path: Path = originalPath;
    const rootLength = path.length;
    const {
      sourceRole: _role,
      sourceDesignation: _designation,
      ...metadata
    } = field.metadata ?? {};
    function visit(child: unknown, label: string, historical = false): boolean {
      if (!remainingNodes || path.length - rootLength > maxDepth) return false;
      remainingNodes -= 1;
      if (child === null || child === '') return false;
      if (typeof child === 'object') {
        let hasChildren = false;
        const container = child as Record<string, unknown>;
        for (const key in container) {
          if (!Object.hasOwn(container, key)) continue;
          hasChildren = true;
          const segment = Array.isArray(child) ? Number(key) : key;
          path.push(segment);
          const suffix =
            typeof segment === 'number'
              ? `[${segment}]`
              : /^[\w-]+$/.test(segment)
                ? `.${segment}`
                : `[${JSON.stringify(segment)}]`;
          const nested = container[key];
          const isHistory =
            typeof segment === 'string' &&
            isHistoricalField(segment, nested !== null && typeof nested === 'object');
          const complete = visit(nested, label + suffix, historical || isHistory);
          path.pop();
          if (!complete) return false;
        }
        return hasChildren;
      }
      if (leaves.length >= extraSlots + 1) return false;
      const sourcePath = JSON.stringify(path);
      const sourceRecordPath = JSON.stringify(path.slice(0, -1));
      const leafValue = String(child);
      const size = leafValue.length + label.length + sourcePath.length + sourceRecordPath.length;
      if (size > remainingUnits) return false;
      remainingUnits -= size;
      leaves.push({
        key: label,
        value: leafValue,
        metadata: {
          ...metadata,
          ...(historical && { sourceAutoMapping: 'manual-only' }),
          sourceKey: String(path[path.length - 1]),
          sourceFieldType: typeof child,
          sourcePath,
          sourceRecordPath,
          sourceStructuredFieldIndex: String(index),
        },
      });
      return true;
    }

    if (!visit(value, field.key)) return [fallback()];
    extraSlots -= leaves.length - 1;
    return leaves;
  });
}
