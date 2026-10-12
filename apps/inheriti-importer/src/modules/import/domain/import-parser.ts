import type {
  ImportedField,
  ImportedNode,
  ImportedSource,
} from '@modules/import/domain/import-model';

/** What a parser adapter returns for one file. */
export interface ParsedImportSource {
  source: ImportedSource;
  nodes: ImportedNode[];
  fields: ImportedField[];
}

export interface ImportParseInput {
  data: ArrayBuffer;
  fileName: string;
  /** Secrets needed to unlock a protected source (KeePass). */
  secrets?: { password?: string; keyFile?: ArrayBuffer };
}

/**
 * The one contract the mapping workspace depends on. Concrete adapters wrap the
 * existing `src/lib/parsers` implementations — the workspace can't import a
 * KeePass/Kubernetes/etc. parser directly.
 */
export interface ImportParser {
  /** Whether this parser can handle the file, cheaply. */
  canParse(fileName: string, data: ArrayBuffer): boolean;
  parse(input: ImportParseInput): Promise<ParsedImportSource>;
}
