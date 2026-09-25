import { describe, expect, it, vi } from 'vitest';
vi.mock('@safetech/inheriti-elements-core/node', () => ({ quickPlanAssetCatalog: [
  { id: 'PLAIN-TEXT', category: 'GENERAL-DATA', fields: ['text'] },
  { id: 'DOCUMENT', category: 'MEDIA-FILES', fields: ['data', 'mimeType'] },
] }));
import { parseQuickPlanInput } from '../src/modules/quick-plan/main/quick-plan-input.js';

describe('quick plan IPC input', () => {
  it('keeps media metadata and rejects unknown secret fields', () => {
    const input = parseQuickPlanInput({
      title: 'My file',
      asset: {
        type: 'DOCUMENT',
        meta: { name: 'Document', notes: 'Keep', code: 'stable-code', matchOrigins: ['https://example.com'], isMedia: true, mimeType: 'application/pdf', fileName: 'sample.pdf' },
        secret: { data: 'YWJj', mimeType: 'application/pdf', fileName: 'sample.pdf', fileSize: 3 },
      },
    });
    expect(input.asset.secret).toEqual({ data: 'YWJj', mimeType: 'application/pdf', fileName: 'sample.pdf', fileSize: 3 });
    expect(input.asset.meta).toEqual({ name: 'Document', notes: 'Keep', code: 'stable-code', matchOrigins: ['https://example.com'], isMedia: true, mimeType: 'application/pdf', fileName: 'sample.pdf' });
    expect(parseQuickPlanInput({ title: 'Note', asset: { type: 'PLAIN-TEXT', meta: { name: 'Note', notes: 'Hidden notes', code: 'note-code', matchOrigins: [] }, secret: { text: 'secret' } } }).asset.meta)
      .toEqual({ name: 'Note', notes: 'Hidden notes', code: 'note-code', matchOrigins: [] });
    expect(() => parseQuickPlanInput({ title: 'Invalid', asset: { type: 'PLAIN-TEXT', meta: { name: 'Note', matchOrigins: [42] }, secret: { text: 'secret' } } })).toThrow();
    expect(() => parseQuickPlanInput({ title: 'Invalid', asset: { type: 'DOCUMENT', meta: { name: 'Document' }, secret: { data: new Blob(['abc']) } } })).toThrow();
    expect(() => parseQuickPlanInput({ title: 'Invalid', asset: { type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'x', bearerToken: 'x' } } })).toThrow();
    for (const fileSize of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '3']) {
      expect(() => parseQuickPlanInput({ title: 'Invalid', asset: { type: 'DOCUMENT', meta: { name: 'Document' }, secret: { data: 'YWJj', fileSize } } })).toThrow();
    }
    expect(() => parseQuickPlanInput({ title: 'Invalid', asset: { type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'secret', fileSize: 3 } } })).toThrow();
  });

  it('roundtrips revealed media and plain-text metadata through the edit form and parser', async () => {
    const editFormPath = '../src/modules/quick-plan/ui/hooks/usePlanEditForm.js';
    const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
    const { formFromAsset } = await import(editFormPath);
    const { buildAsset } = await import(assetInputPath);
    const data = Buffer.from('existing bytes').toString('base64');
    const media = { type: 'DOCUMENT', meta: { name: 'Document', notes: 'Keep', code: 'stable-code', matchOrigins: ['https://example.com'], isMedia: true, mimeType: 'application/pdf', fileName: 'paper.pdf' }, secret: { data, mimeType: 'application/pdf', fileName: 'paper.pdf' } };
    const mediaForm = formFromAsset(media);
    mediaForm.assetName = 'Renamed';
    const mediaInput = await buildAsset(mediaForm, { id: 'DOCUMENT', category: 'MEDIA-FILES', fields: ['data', 'mimeType'] });
    expect(parseQuickPlanInput({ title: 'Edit', asset: mediaInput }).asset).toEqual({
      type: 'DOCUMENT', meta: { name: 'Renamed', notes: 'Keep', code: 'stable-code', matchOrigins: ['https://example.com'], isMedia: true, mimeType: 'application/pdf', fileName: 'paper.pdf' },
      secret: { data, mimeType: 'application/pdf', fileName: 'paper.pdf' },
    });

    const note = { type: 'PLAIN-TEXT', meta: { name: 'Note', notes: 'Keep', code: 'note-code', matchOrigins: [] }, secret: { text: 'secret' } };
    const noteInput = await buildAsset(formFromAsset(note), { id: 'PLAIN-TEXT', category: 'GENERAL-DATA', fields: ['text'] });
    expect(parseQuickPlanInput({ title: 'Edit', asset: noteInput }).asset).toEqual(note);
  });
});
