import { SwitchField } from '../../../../_shared/ui/components/Form/SwitchField.jsx';
import { TextareaField } from '../../../../_shared/ui/components/Form/TextareaField.jsx';

export function AdditionalNotesInput({ form, messages, updateField, disabled }) {
  const enabled = Boolean(form.fields.includeNotes || form.fields.notes);
  return <>
    <SwitchField id="asset-include-notes" label={messages.includeNotes} checked={enabled}
      onChange={(checked) => { updateField('includeNotes', checked); if (!checked) updateField('notes', ''); }} disabled={disabled} />
    {enabled && <TextareaField id="asset-notes" label={messages.assetNotes} value={form.fields.notes || ''}
      onChange={(value) => updateField('notes', value)} required disabled={disabled} />}
  </>;
}
