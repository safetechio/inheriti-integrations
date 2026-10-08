import { SelectField } from '../../../../_shared/ui/components/Form/SelectField.jsx';
import { TextField } from '../../../../_shared/ui/components/Form/TextField.jsx';
import { blockchains } from '../../asset-form-rules.js';

export function BlockchainInput({ value, customValue, onChange, onCustomChange, disabled, messages }) {
  return <>
    <SelectField id="asset-blockchain" label={messages.assetFields.blockchain} value={value}
      onChange={(next) => { onChange(next); if (next !== 'Other') onCustomChange(''); }}
      options={[{ value: '', label: messages.chooseBlockchain }, ...blockchains.map((blockchain) => ({ value: blockchain, label: blockchain === 'Other' ? messages.otherOption : blockchain }))]}
      required disabled={disabled} />
    {value === 'Other' && <TextField id="asset-customBlockchain" label={messages.assetFields.customBlockchain}
      value={customValue} onChange={onCustomChange} required disabled={disabled} />}
  </>;
}
