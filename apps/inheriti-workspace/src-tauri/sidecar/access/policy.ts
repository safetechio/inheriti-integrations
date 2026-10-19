/** Current host preview limits. The Client SDK remains the authority for file access and decryption. */
export type PreviewMime = 'text/plain' | 'image/webp' | 'application/pdf';

export function checkPreviewPolicy(fileBytes: Uint8Array, mimeType: string): { mimeType: PreviewMime; maxPlaintext: number } {
  if (mimeType !== 'text/plain' && mimeType !== 'image/webp' && mimeType !== 'application/pdf') throw new Error('unsupported_file_type');
  if (mimeType !== 'text/plain' && process.platform !== 'linux') throw new Error('unsupported_file_type');
  const maxPlaintext = mimeType === 'text/plain' ? 45 * 1024 : 1024 * 1024;
  const headerLength = new DataView(fileBytes.buffer, fileBytes.byteOffset + 8, 4).getUint32(0);
  if (fileBytes.length - 12 - headerLength - 12 - 16 > maxPlaintext) throw new Error('file_too_large');
  return { mimeType, maxPlaintext };
}

export function checkOpenedPreview(mimeType: string, expectedMimeType: PreviewMime, plaintextLength: number, maxPlaintext: number): void {
  if (mimeType !== expectedMimeType || plaintextLength > maxPlaintext) throw new Error('file_too_large');
}
