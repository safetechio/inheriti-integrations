import { useCallback, useEffect, useState } from 'react';

export function useInboxState(autoPrepare = false) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  const prepare = useCallback(async () => {
    setError('');
    try { setState(await window.inheritiTray.inboxPrepare()); }
    catch { setError('Could not prepare Secure Inbox. Sign in and try again.'); }
  }, []);

  useEffect(() => {
    const stop = window.inheritiTray.onInboxStateChanged(setState);
    void window.inheritiTray.inboxState().then((current) => {
      setState(current);
      if (autoPrepare && current.status !== 'ready') void prepare();
    }).catch(() => setError('Could not load Secure Inbox status.'));
    return stop;
  }, [autoPrepare, prepare]);

  return { state, error, prepare };
}
