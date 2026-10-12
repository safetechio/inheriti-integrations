import { useEffect, useState } from 'react';

/**
 * Browser online/offline signal, used to distinguish a genuinely offline host
 * from any other session-confirmation failure (`derive-session-proof-status`).
 * Not a guarantee of real connectivity to the Business API — only a UI hint.
 */
export default function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
