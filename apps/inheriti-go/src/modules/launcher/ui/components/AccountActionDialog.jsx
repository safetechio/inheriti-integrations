import { useEffect, useRef } from 'react';

export function AccountActionDialog({ title, children, confirmLabel, onConfirm, onCancel, busy = false, danger = false, progressLabel = 'Checking account…' }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return <dialog ref={dialog} className="tray-account-dialog tray-account-confirmation" aria-label={title}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="tray-account-dialog-content">
      <h1>{title}</h1>
      {children}
      {busy ? <div className="tray-account-dialog-progress" role="status"><span className="tray-restoring-track" aria-hidden="true"><span /></span>{progressLabel}</div>
        : <div className="tray-account-dialog-actions">
          <button type="button" className="tray-account-dialog-cancel" autoFocus onClick={onCancel}>Cancel</button>
          <button type="button" className={danger ? 'button-sign-out' : undefined} onClick={onConfirm}>{confirmLabel}</button>
        </div>}
    </div>
  </dialog>;
}
