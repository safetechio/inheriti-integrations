import { useCallback, useEffect, useRef, useState } from 'react';

let nextRequestId = 0;

export function useInboxAccess(organizationId) {
  const [result, setResult] = useState({ status: 'checking', error: '' });
  const generation = useRef(0);
  const requestId = useRef(null);
  const check = useCallback(async () => {
    const current = ++generation.current;
    const id = ++nextRequestId;
    requestId.current = id;
    setResult({ status: 'checking', error: '' });
    try {
      await window.inheritiTray.inboxAccess(id);
      if (current === generation.current) setResult({ status: 'ready', error: '' });
    } catch {
      if (current === generation.current) setResult({ status: 'error', error: 'Could not validate the organisation key. Try again.' });
    }
  }, []);

  useEffect(() => {
    if (organizationId) void check();
    return () => {
      generation.current++;
      if (requestId.current !== null) void window.inheritiTray.inboxCancelAccess(requestId.current);
    };
  }, [organizationId, check]);

  return { status: result.status, error: result.error, retry: check };
}
