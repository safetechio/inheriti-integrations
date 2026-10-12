import type { AssetFormProps } from '@modules/plans/ui/asset-editor';
import { AssetForm, AssetTextField, useAssetForm, type AssetFormValues } from './AssetForm';

/** Local Importer form matching Business Plain Text behavior. */
export function PlainTextAssetForm({ asset, onSubmit, onCancel }: AssetFormProps) {
  const methods = useAssetForm({
    meta: asset?.meta,
    secret: asset?.secret,
  });

  function save(values: AssetFormValues) {
    onSubmit({
      id: asset?.id,
      type: 'PLAIN-TEXT',
      meta: values.meta,
      secret: values.secret,
    });
  }

  return (
    <AssetForm methods={methods} onSubmit={save} onCancel={onCancel}>
      <AssetTextField source="meta.name" label="Asset name" required />
      <AssetTextField source="secret.text" label="Text" multiline required />
    </AssetForm>
  );
}

export default PlainTextAssetForm;
