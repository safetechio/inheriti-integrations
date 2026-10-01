import { useEffect, useState } from 'react';

export function useInboxState() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const stop = window.inheritiTray.onInboxStateChanged(setState);
    void window.inheritiTray.inboxState().then(setState).catch(() => setError('Could not load Secure Inbox status.'));
    return stop;
  }, []);

  async function prepare() {
    setError('');
    try { setState(await window.inheritiTray.inboxPrepare()); }
    catch { setError('Could not prepare Secure Inbox. Sign in and try again.'); }
  }

  return { state, error, prepare };
}
