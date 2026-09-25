import { validateAssetForm } from './asset-form-rules.js';

export async function buildAsset(input, definition) {
  validateAssetForm(input, definition);
  const meta = { name: input.assetName.trim() };
  const secret = {};
  const original = input.existingMeta;
  if (original?.code !== undefined) meta.code = original.code;
  if (original?.matchOrigins !== undefined) meta.matchOrigins = original.matchOrigins.slice();
  if (input.fields?.notes) meta.notes = input.fields.notes;

  if (isMedia(definition)) {
    const file = input.file;
    if (!file) throw new Error('file_required');
    if (file.existing && !input.existingMedia?.data) throw new Error('file_required');
    if (!file.existing && file.size > 10 * 1024 * 1024) throw new Error('file_too_large');
    const mimeType = file.existing ? input.existingMedia.mimeType || 'application/octet-stream' : file.type || 'application/octet-stream';
    const fileName = file.existing ? input.existingMedia.fileName : file.name;
    const dataUrl = file.existing ? null : await readFile(file);
    const data = file.existing ? input.existingMedia.data : dataUrl.slice(dataUrl.indexOf(',') + 1);
    meta.isMedia = true;
    meta.mimeType = mimeType;
    if (fileName !== undefined) meta.fileName = fileName;
    secret.data = data;
    secret.mimeType = mimeType;
    if (fileName !== undefined) secret.fileName = fileName;
    const fileSize = file.existing ? input.existingMedia.fileSize : file.size;
    if (fileSize !== undefined) secret.fileSize = fileSize;
  } else {
    for (const field of definition.fields) {
      const value = input.fields[field];
      if (value === undefined || value === '') continue;
      if (field === 'words') {
        const words = Array.isArray(value) ? value : value.trim().split(/\s+/);
        if (!words.length || words.length > 24 || words.some((word) => typeof word !== 'string' || !word.trim() || word.trim().length > 8)) throw new Error('invalid_seed_words');
        secret.words = words.map((word) => word.trim());
        continue;
      }
      if (field === 'customBlockchain' || field === 'customWallet') continue;
      if (field === 'blockchain' && value === 'Other') { secret.blockchain = 'Other'; secret.customBlockchain = input.fields.customBlockchain.trim(); continue; }
      if (field === 'wallet' && value === 'Other') { secret.wallet = 'Other'; secret.customWallet = input.fields.customWallet.trim(); continue; }
      secret[field] = typeof value === 'string' && field.startsWith('custom') ? value.trim() : value;
    }
    if (definition.id === 'SEED-PHRASE' && !secret.words) throw new Error('invalid_seed_words');
  }

  return { type: original?.originalType === 'PDF' && definition.id === 'DOCUMENT' ? 'PDF' : definition.id, meta, secret };
}

export function isMedia(definition) {
  return definition.category === 'MEDIA-FILES';
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
