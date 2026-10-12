import { useCallback, useEffect, useRef, useState } from 'react';

export function useInboxState(organizationId) {
  const [snapshot, setSnapshot] = useState(null);
  const [failure, setFailure] = useState(null);
  const generation = useRef(0);
  const scope = useRef({ organizationId, epoch: 0 });
  if (scope.current.organizationId !== organizationId) scope.current = { organizationId, epoch: scope.current.epoch + 1 };

  const run = useCallback(async (operation, message) => {
    const current = generation.current;
    const epoch = scope.current.epoch;
    setFailure(null);
    try {
      const state = await operation();
      if (current === generation.current && epoch === scope.current.epoch) setSnapshot({ epoch, state });
    } catch {
      if (current === generation.current && epoch === scope.current.epoch) setFailure({ epoch, message });
    }
  }, [organizationId]);

  const prepare = useCallback(() => run(() => window.inheritiTray.inboxPrepare(),
    'Could not prepare Secure Chat. Sign in and try again.'), [run]);
  const replace = useCallback(() => run(() => window.inheritiTray.inboxReplaceDevice(),
    'Could not replace Secure Chat access on this computer. Try again.'), [run]);

  useEffect(() => {
    const current = ++generation.current;
    if (!organizationId) return () => { generation.current++; };
    const epoch = scope.current.epoch;
    let seenEvent = false;
    const stop = window.inheritiTray.onInboxStateChanged((state) => {
      if (current === generation.current && epoch === scope.current.epoch) {
        seenEvent = true;
        setSnapshot({ epoch, state });
        if (state.status === 'missing') void prepare();
      }
    });
    void window.inheritiTray.inboxState().then((state) => {
      if (current !== generation.current || epoch !== scope.current.epoch || seenEvent) return;
      setSnapshot({ epoch, state });
      if (state.status === 'missing') void prepare();
    }).catch(() => {
      if (current === generation.current && epoch === scope.current.epoch && !seenEvent) setFailure({ epoch, message: 'Could not load Secure Chat status.' });
    });
    return () => { generation.current++; stop(); };
  }, [organizationId, prepare]);

  return {
    state: snapshot?.epoch === scope.current.epoch ? snapshot.state : null,
    error: failure?.epoch === scope.current.epoch ? failure.message : '',
    prepare,
    replace,
  };
}
