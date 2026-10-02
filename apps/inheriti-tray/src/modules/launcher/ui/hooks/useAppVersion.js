import { useEffect, useState } from 'react';

export function useAppVersion() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.inheritiTray.version?.().then(setVersion).catch(() => {});
  }, []);
  return version;
}
