import { useState } from 'react';
import { blockchains, wallets } from '../asset-form-rules.js';

const blankForm = () => ({ assetType: '', assetName: '', fields: {}, file: null, existingMedia: null, existingMeta: null });

export function usePlanEditForm() {
  const [form, setForm] = useState(blankForm);
  const resetForm = () => setForm(blankForm());
  const loadAsset = (asset) => setForm(formFromAsset(asset));
  return { form, setForm, resetForm, loadAsset };
}

export function formFromAsset(asset) {
  const fields = {};
  for (const [field, value] of Object.entries(asset.secret || {})) {
    if (field === 'data' || field === 'mimeType' || field === 'fileName' || field === 'fileSize') continue;
    fields[field] = Array.isArray(value) ? value.slice() : String(value);
  }
  for (const [field, options] of [['blockchain', blockchains], ['wallet', wallets]]) {
    if (fields[field] && !options.includes(fields[field])) {
      fields[`custom${field[0].toUpperCase()}${field.slice(1)}`] = fields[field];
      fields[field] = 'Other';
    }
  }
  if (asset.meta.notes) fields.notes = asset.meta.notes;
  const existingMeta = {
    code: asset.meta.code,
    matchOrigins: asset.meta.matchOrigins?.slice(),
    isMedia: asset.meta.isMedia,
    mimeType: asset.meta.mimeType,
    fileName: asset.meta.fileName,
    originalType: asset.type,
  };
  const existingMedia = asset.secret?.data ? {
    data: asset.secret.data,
    mimeType: asset.secret.mimeType || asset.meta.mimeType,
    fileName: asset.secret.fileName || asset.meta.fileName,
    fileSize: asset.secret.fileSize,
  } : null;
  const file = existingMedia ? { name: existingMedia.fileName || asset.meta.name, existing: true } : null;
  return { assetType: asset.type === 'PDF' ? 'DOCUMENT' : asset.type, assetName: asset.meta.name, fields, file, existingMedia, existingMeta };
}
