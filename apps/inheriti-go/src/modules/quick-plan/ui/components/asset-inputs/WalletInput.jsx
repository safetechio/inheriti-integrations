import { SelectField } from '../../../../_shared/ui/components/Form/SelectField.jsx';
import { TextField } from '../../../../_shared/ui/components/Form/TextField.jsx';
import { wallets } from '../../asset-form-rules.js';

export function WalletInput({ value, customValue, onChange, onCustomChange, disabled, messages }) {
  return <>
    <SelectField id="asset-wallet" label={messages.assetFields.wallet} value={value}
      onChange={(next) => { onChange(next); if (next !== 'Other') onCustomChange(''); }}
      options={[{ value: '', label: messages.chooseWallet }, ...wallets.map((wallet) => ({ value: wallet, label: wallet === 'Other' ? messages.otherOption : wallet }))]}
      required disabled={disabled} />
    {value === 'Other' && <TextField id="asset-customWallet" label={messages.assetFields.customWallet}
      value={customValue} onChange={onCustomChange} required disabled={disabled} />}
  </>;
}
