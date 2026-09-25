import { DropzoneField } from '../../../_shared/ui/components/Form/DropzoneField.jsx';
import { BlockchainInput } from './asset-inputs/BlockchainInput.jsx';
import { WalletInput } from './asset-inputs/WalletInput.jsx';
import { SecretInput } from './asset-inputs/SecretInput.jsx';
import { AdditionalNotesInput } from './asset-inputs/AdditionalNotesInput.jsx';
import { isMedia } from '../asset-input.js';

export function AssetFields({ definition, form, messages, update, updateField, disabled }) {
  if (isMedia(definition)) {
    return <>
      <DropzoneField id="asset-file" label={messages.assetFile} value={form.file}
        onChange={(file) => update({ file })}
        maxSizeMb={10} required disabled={disabled} />
      <AdditionalNotesInput form={form} messages={messages} updateField={updateField} disabled={disabled} />
    </>;
  }

  return <>
    {definition.fields.filter((field) => field !== 'customBlockchain' && field !== 'customWallet').map((field) => {
      if (field === 'blockchain') return <BlockchainInput key={field} value={form.fields.blockchain || ''}
        customValue={form.fields.customBlockchain || ''} onChange={(value) => updateField('blockchain', value)}
        onCustomChange={(value) => updateField('customBlockchain', value)} disabled={disabled} messages={messages} />;
      if (field === 'wallet') return <WalletInput key={field} value={form.fields.wallet || ''}
        customValue={form.fields.customWallet || ''} onChange={(value) => updateField('wallet', value)}
        onCustomChange={(value) => updateField('customWallet', value)} disabled={disabled} messages={messages} />;
      return <SecretInput key={field} field={field} assetType={definition.id} value={form.fields[field]}
        onChange={(value) => updateField(field, value)} disabled={disabled} messages={messages} />;
    })}
    {definition.id !== 'PLAIN-TEXT' && <AdditionalNotesInput form={form} messages={messages} updateField={updateField} disabled={disabled} />}
  </>;
}
