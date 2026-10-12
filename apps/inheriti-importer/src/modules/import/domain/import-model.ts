/**
 * The normalized source model every parser adapter produces. The mapping
 * workspace only ever sees this shape — never a KeePass/Kubernetes/etc.
 * structure.
 */

/** A masked wrapper so a raw secret is never logged or rendered by accident. */
export class SensitiveValue {
  #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Explicit, deliberate read — call sites are auditable. */
  reveal(): string {
    return this.#value;
  }

  get length(): number {
    return this.#value.length;
  }

  get isEmpty(): boolean {
    return this.#value.length === 0;
  }

  toString(): string {
    return this.#value ? '••••••••' : '';
  }

  toJSON(): string {
    return this.#value ? '[redacted]' : '';
  }

  /** Best-effort wipe of the backing string reference. */
  clear(): void {
    this.#value = '';
  }
}

export interface ImportedSource {
  id: string;
  kind: string;
  name: string;
  fileName: string;
  importedAt: string;
  warnings: string[];
}

export interface ImportedNode {
  id: string;
  sourceId: string;
  parentNodeId: string | null;
  /** 'group' for a folder/namespace, 'entry' for a single credential record. */
  kind: 'group' | 'entry';
  name: string;
  path: string[];
  childNodeIds: string[];
  fieldIds: string[];
}

export interface ImportedField {
  id: string;
  sourceId: string;
  parentNodeId: string;
  sourcePath: string[];
  name: string;
  value: SensitiveValue;
  detectedType?: string;
  metadata: Record<string, string>;
}

export interface ImportSession {
  id: string;
  sources: ImportedSource[];
  rootNodeIds: string[];
  nodesById: Record<string, ImportedNode>;
  fieldsById: Record<string, ImportedField>;
}

export function createEmptyImportSession(id: string): ImportSession {
  return { id, sources: [], rootNodeIds: [], nodesById: {}, fieldsById: {} };
}

/** Best-effort wipe of every secret value in a session. */
export function clearImportSession(session: ImportSession): void {
  for (const field of Object.values(session.fieldsById)) {
    field.value.clear();
  }
}
