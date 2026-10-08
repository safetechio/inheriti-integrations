import { useState } from 'react';
import { FieldShell } from './FieldShell.jsx';
import { placePastedWords } from './seed-words.js';

export function SeedWordsField({ id, label, value, onChange, required = false, disabled = false, error }) {
  const [visible, setVisible] = useState(false);
  const [pasteError, setPasteError] = useState('');
  const words = Array.isArray(value) ? value.slice(0, 24) : [];
  const shown = words.length ? words : [''];
  const update = (index, next) => {
    const updated = shown.map((word, current) => current === index ? next.replace(/\s/g, '').slice(0, 8) : word);
    onChange(updated);
  };
  return <FieldShell id={id} label={label} required={required} error={error || pasteError}>
    <div className="seed-words">
      {shown.map((word, index) => <span className="seed-word" key={index}>
        <input id={index === 0 ? id : `${id}-${index + 1}`} name={`${id}-${index + 1}`} type={visible ? 'text' : 'password'} value={word} onChange={(event) => { setPasteError(''); update(index, event.target.value); }} onPaste={(event) => {
          event.preventDefault();
          try { onChange(placePastedWords(shown, index, event.clipboardData.getData('text'))); setPasteError(''); }
          catch { setPasteError('Use at most 24 words, with up to 8 characters each.'); }
        }} placeholder={`Word ${index + 1}`} aria-label={`Word ${index + 1}`} maxLength={8} autoComplete="off" required={required} disabled={disabled} />
        {shown.length > 1 && <button type="button" className="field-action" disabled={disabled} aria-label={`Remove word ${index + 1}`} onClick={() => onChange(shown.filter((_, current) => current !== index))}>×</button>}
      </span>)}
    </div>
    <div className="seed-actions"><button type="button" className="button-secondary" disabled={disabled || shown.length >= 24} onClick={() => onChange([...shown, ''])}>Add word</button><button type="button" className="button-secondary" disabled={disabled} onClick={() => setVisible(!visible)} aria-pressed={visible}>{visible ? 'Hide words' : 'Show words'}</button></div>
  </FieldShell>;
}
