import { useCallback, useEffect, useState } from 'react';

export function useInboxState(autoPrepare = false) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  const prepare = useCallback(async () => {
    setError('');
    try { setState(await window.inheritiTray.inboxPrepare()); }
    catch { setError('Could not prepare Secure Chat. Sign in and try again.'); }
  }, []);
  const replace = useCallback(async () => {
    setError('');
    try { setState(await window.inheritiTray.inboxReplaceDevice()); }
    catch { setError('Could not replace Secure Chat access on this computer. Try again.'); }
  }, []);

  useEffect(() => {
    const stop = window.inheritiTray.onInboxStateChanged(setState);
    void window.inheritiTray.inboxState().then((current) => {
      setState(current);
      if (autoPrepare && current.status !== 'ready') void prepare();
    }).catch(() => setError('Could not load Secure Chat status.'));
    return stop;
  }, [autoPrepare, prepare]);

  return { state, error, prepare, replace };
}
