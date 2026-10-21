/** SDK adapter for inspecting and opening a sealed file.
 * This is the host's file policy boundary, not an isolation runtime.
 */
import { randomUUID } from 'node:crypto';
import type { FileAccessStatus } from '../../../../../../inheriti-client-sdk/sdk/src/elements/elements-api-port.js';
import { ElementsApiRequestFailed } from '../../../../../../inheriti-client-sdk/sdk/src/elements/http-elements-api-port.js';
import { inspectInheritiFileAccess, openInheritiFileAccess, readInheritiFileHeader, MAX_INHERITI_FILE_BYTES } from '../../../../../../inheriti-client-sdk/sdk/node.js';
import type { WorkspaceApi } from '../session/workspace-session.js';
import { readStartupFile } from './startup-file.js';
import { checkGuestPolicy, checkOpenedPreview, checkPreviewPolicy } from './policy.js';
import type { GuestMime, PreviewMime } from './policy.js';

export async function inspectStartupFileAccess(path: string | undefined, organizationIds: string[], apiForOrganization: (id: string) => WorkspaceApi): Promise<{ id: string; access: FileAccessStatus }> {
  const bytes = await readStartupFile(path, MAX_INHERITI_FILE_BYTES);
  try {
    let match: { id: string; access: FileAccessStatus } | undefined;
    for (const id of organizationIds) {
      try {
        const { access } = await inspectInheritiFileAccess({ fileBytes: bytes, api: apiForOrganization(id) });
        if (match) throw new Error('file_access_unavailable');
        match = { id, access };
      } catch (error) {
        if (error instanceof ElementsApiRequestFailed && error.code === 'file_access_not_allowed') continue;
        throw error;
      }
    }
    if (!match) throw new Error('file_access_unavailable');
    return match;
  } finally { bytes.fill(0); }
}

export async function inspectStartupFileMime(path: string | undefined): Promise<string> {
  const bytes = await readStartupFile(path, MAX_INHERITI_FILE_BYTES);
  try { return readInheritiFileHeader(bytes).mimeType; }
  finally { bytes.fill(0); }
}

export async function openStartupFileAccess(
  path: string | undefined,
  api: WorkspaceApi,
  delivery: 'REVEAL' | 'MOBILE',
  signal: AbortSignal,
  onPairingCode?: (code: string) => void,
  destination: 'preview' | 'guest' = 'preview',
): Promise<{ mimeType: GuestMime | PreviewMime; contentBase64: string; expiresAt: string | null }> {
  let fileBytes: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    fileBytes = await readStartupFile(path, 1024 * 1024 + 4096 + 40);
    const header = readInheritiFileHeader(fileBytes);
    const { mimeType, maxPlaintext } = destination === 'guest'
      ? checkGuestPolicy(fileBytes, header.mimeType)
      : checkPreviewPolicy(fileBytes, header.mimeType);
    const openingApi = delivery === 'REVEAL' ? {
      getFileAccess: api.getFileAccess.bind(api),
      requestFileAccessOpening: async (...args: Parameters<WorkspaceApi['requestFileAccessOpening']>) => {
        try { return await api.requestFileAccessOpening(...args); }
        catch { throw new Error('reveal_delivery_unavailable'); }
      },
      readFileAccessOpening: api.readFileAccessOpening.bind(api),
      confirmFileAccessDelivery: api.confirmFileAccessDelivery.bind(api),
    } : api;
    const opened = await openInheritiFileAccess({
      fileBytes,
      api: openingApi,
      sessionId: randomUUID(),
      delivery,
      signal,
      onPairingCode,
    });
    plaintext = opened.plaintext;
    if (signal.aborted) throw new Error('opening_cancelled');
    checkOpenedPreview(opened.header.mimeType, mimeType, plaintext.length, maxPlaintext);
    const copy = Buffer.from(plaintext);
    try { return { mimeType, contentBase64: copy.toString('base64'), expiresAt: opened.header.expiresAt }; }
    finally { copy.fill(0); }
  } finally {
    fileBytes?.fill(0);
    plaintext?.fill(0);
  }
}
