import { useRef, useState } from 'react';
import { FieldShell } from './FieldShell.jsx';

export function DropzoneField({ id, label, value, onChange, required = false, disabled = false, maxSizeMb = 10, onError, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState('');
  const reportError = (message) => { setLocalError(message); onError?.(message); };
  const accept = (file) => {
    if (!file || disabled) return;
    if (file.size > maxSizeMb * 1024 * 1024) { reportError(`File size exceeds ${maxSizeMb} MB. Please choose a smaller file.`); return; }
    setLocalError('');
    onChange(file);
  };
  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
    if (inputRef.current) inputRef.current.value = '';
  };
  return <FieldShell id={id} label={label} required={required} error={error || localError}>
    <div className={`dropzone${dragging ? ' dropzone-active' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <input ref={inputRef} className="dropzone-input" id={id} name={id} type="file" required={required && !value} disabled={disabled} onChange={(event) => { accept(event.target.files[0]); event.target.value = ''; }} aria-describedby={error || localError ? `${id}-error` : undefined} />
      {value ? <div className="dropzone-selection"><span title={value.name}>{value.name}</span><button type="button" className="field-action" disabled={disabled} onClick={() => inputRef.current?.click()}>Replace</button><button type="button" className="field-action" disabled={disabled} onClick={() => { onChange(null); setLocalError(''); }}>Remove</button></div> : <span>Drag &amp; drop a file here or <button type="button" className="field-action" disabled={disabled} onClick={() => inputRef.current?.click()}>browse</button></span>}
      <small>Maximum file size: {maxSizeMb} MB</small>
    </div>
  </FieldShell>;
}
