export async function buildAsset(input, definition) {
  const meta = { name: input.assetName.trim() };
  const secret = {};

  if (isMedia(definition.id)) {
    const file = input.file;
    if (!file) throw new Error('file_required');
    if (file.size > 18_000_000) throw new Error('file_too_large');
    const dataUrl = await readFile(file);
    const mimeType = file.type || 'application/octet-stream';
    meta.isMedia = true;
    meta.mimeType = mimeType;
    meta.fileName = file.name;
    secret.data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    secret.mimeType = mimeType;
    secret.fileName = file.name;
  } else {
    for (const field of definition.fields) {
      const value = input.fields[field];
      if (value === undefined || value === '') continue;
      secret[field] = field === 'words' ? value.trim().split(/\s+/) : value;
    }
  }

  return { type: definition.id, meta, secret };
}

export function isMedia(type) {
  return type === 'DOCUMENT' || type === 'IMAGE' || type === 'VIDEO';
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
