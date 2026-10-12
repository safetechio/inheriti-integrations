import {
  getAssetUiExtension,
  validateAssetEditorValues,
} from '@modules/plans/domain/asset-metadata';
import type { AssetFormProps } from '@modules/plans/ui/asset-editor';
import { AssetForm, AssetTextField, useAssetForm, type AssetFormValues } from './AssetForm';

const PASSWORD_FIELDS = new Set(['password', 'apiKey', 'privateKey', 'pinCode', 'code']);

/** Local RHF composition for non-media Assets. Visual controls stay Importer-owned. */
export function StandardAssetForm({ asset, assetType, onSubmit, onCancel }: AssetFormProps) {
  const methods = useAssetForm({ meta: asset?.meta, secret: asset?.secret });
  const extension = getAssetUiExtension(assetType);
  const fields = extension?.formFields ?? [];

  function save(values: AssetFormValues) {
    const errors = validateAssetEditorValues(assetType, values);
    for (const [source, message] of Object.entries(errors)) {
      methods.setError(source as never, { type: 'validation', message });
    }
    if (Object.keys(errors).length > 0) return;

    onSubmit({
      id: asset?.id,
      type: assetType,
      meta: values.meta,
      secret: values.secret,
    });
  }

  return (
    <AssetForm methods={methods} onSubmit={save} onCancel={onCancel}>
      <AssetTextField source="meta.name" label="Asset name" required />
      {fields
        .filter((field) => field.source !== 'meta.name')
        .map((field) => (
          <AssetTextField
            key={field.source}
            source={field.source as `secret.${string}`}
            label={field.id.replaceAll('-', ' ')}
            multiline={field.inputKind === 'textarea' || field.inputKind === 'word-list'}
            secure={PASSWORD_FIELDS.has(field.source.split('.').at(-1) ?? '')}
          />
        ))}
    </AssetForm>
  );
}

export default StandardAssetForm;
