import { expect, it } from 'vitest';
import {
  getAssetUiExtension,
  getCorePlanAssetTypes,
  getImportablePlanAssetTypes,
} from '@modules/plans/domain/asset-metadata';

it('excludes only file assets from Importer choices while retaining their SDK schemas', () => {
  const fileTypes = ['DOCUMENT', 'IMAGE', 'VIDEO'];
  const coreTypes = getCorePlanAssetTypes();

  expect(coreTypes).toEqual(expect.arrayContaining(fileTypes));
  expect(getImportablePlanAssetTypes()).toEqual(
    coreTypes.filter((type) => !fileTypes.includes(type)),
  );
  for (const type of fileTypes) {
    expect(getAssetUiExtension(type)).toMatchObject({ type, isMedia: true });
  }
});
