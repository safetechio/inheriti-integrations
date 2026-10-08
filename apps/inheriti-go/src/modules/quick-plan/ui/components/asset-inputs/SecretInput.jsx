import { TextField } from '../../../../_shared/ui/components/Form/TextField.jsx';
import { PasswordField } from '../../../../_shared/ui/components/Form/PasswordField.jsx';
import { PasswordTextareaField } from '../../../../_shared/ui/components/Form/PasswordTextareaField.jsx';
import { EmailField } from '../../../../_shared/ui/components/Form/EmailField.jsx';
import { CardNumberField } from '../../../../_shared/ui/components/Form/CardNumberField.jsx';
import { ExpiryDateField } from '../../../../_shared/ui/components/Form/ExpiryDateField.jsx';
import { SeedWordsField } from '../../../../_shared/ui/components/Form/SeedWordsField.jsx';
import { fieldMaxLength, fieldRequired } from '../../asset-form-rules.js';

const controls = {
  text: PasswordTextareaField, email: EmailField, password: PasswordField,
  code: PasswordField, apiKey: PasswordField, privateKey: PasswordField,
  pinCode: PasswordField, words: SeedWordsField, cardNumber: CardNumberField,
  expiryDate: ExpiryDateField,
};
export function SecretInput({ field, assetType, value, onChange, disabled, messages }) {
  const Control = controls[field] || TextField;
  const maxLength = fieldMaxLength(field, assetType);
  return <Control id={`asset-${field}`} label={messages.assetFields[field] || field}
    value={field === 'words' ? value || [] : value || ''} onChange={onChange}
    required={fieldRequired(field)} maxLength={maxLength} disabled={disabled} />;
}
