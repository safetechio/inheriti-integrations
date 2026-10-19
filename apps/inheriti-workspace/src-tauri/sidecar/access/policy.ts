/** Current host preview limits. The Client SDK remains the authority for file access and decryption. */
export type PreviewMime = 'text/plain' | 'image/webp' | 'application/pdf';
export type GuestMime = 'text/plain' | 'application/pdf' | 'text/csv' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function checkPreviewPolicy(fileBytes: Uint8Array, mimeType: string): { mimeType: PreviewMime; maxPlaintext: number } {
  if (mimeType !== 'text/plain' && mimeType !== 'image/webp' && mimeType !== 'application/pdf') throw new Error('unsupported_file_type');
  if (mimeType !== 'text/plain' && process.platform !== 'linux') throw new Error('unsupported_file_type');
  const maxPlaintext = mimeType === 'text/plain' ? 45 * 1024 : 1024 * 1024;
  const headerLength = new DataView(fileBytes.buffer, fileBytes.byteOffset + 8, 4).getUint32(0);
  if (fileBytes.length - 12 - headerLength - 12 - 16 > maxPlaintext) throw new Error('file_too_large');
  return { mimeType, maxPlaintext };
}

/** Guest admission is separate from the host preview policy on every platform. */
export function checkGuestPolicy(fileBytes: Uint8Array, mimeType: string): { mimeType: GuestMime; maxPlaintext: number } {
  if (mimeType !== 'text/plain' && mimeType !== 'application/pdf' && mimeType !== 'text/csv'
      && mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      && mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') throw new Error('unsupported_file_type');
  const maxPlaintext = mimeType === 'text/plain' ? 45 * 1024 : 1024 * 1024;
  const headerLength = new DataView(fileBytes.buffer, fileBytes.byteOffset + 8, 4).getUint32(0);
  if (fileBytes.length - 12 - headerLength - 12 - 16 > maxPlaintext) throw new Error('file_too_large');
  return { mimeType, maxPlaintext };
}

export function checkOpenedPreview(mimeType: string, expectedMimeType: PreviewMime | GuestMime, plaintextLength: number, maxPlaintext: number): void {
  if (mimeType !== expectedMimeType || plaintextLength > maxPlaintext) throw new Error('file_too_large');
}
