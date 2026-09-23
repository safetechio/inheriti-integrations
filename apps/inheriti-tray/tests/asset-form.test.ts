import { expect, it } from 'vitest';

it('preserves leading, trailing, and whitespace-only text secrets', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const definition = { id: 'PLAIN-TEXT', fields: ['text'] };
  const input = { assetName: ' Note ', fields: { text: '  keep this text  ' } };
  await expect(buildAsset(input, definition)).resolves.toEqual({
    type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: '  keep this text  ' },
  });
  input.fields.text = '   ';
  await expect(buildAsset(input, definition)).resolves.toMatchObject({ secret: { text: '   ' } });
});

it('rejects oversized media before reading it', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const file = { size: 18_000_001, name: 'large.pdf', type: 'application/pdf' };
  await expect(buildAsset({ assetName: 'Document', file }, { id: 'DOCUMENT', fields: ['data'] }))
    .rejects.toThrow('file_too_large');
});
