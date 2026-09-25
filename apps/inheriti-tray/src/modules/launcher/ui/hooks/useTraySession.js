import { useEffect, useState } from 'react';

export function useTraySession(messages) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const stop = window.inheritiTray.onStateChanged(setState);
    void window.inheritiTray.state()
      .then(setState)
      .catch((cause) => setError(cause instanceof Error ? cause.message : messages.retryError));
    return stop;
  }, [messages]);

  async function signIn() {
    try {
      setState(await window.inheritiTray.signIn());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.signInFailed);
    }
  }

  async function openApp(planId) {
    try {
      await window.inheritiTray.openApp(planId);
    } catch {
      setError(messages.appUrlError);
    }
  }

  return { state, setState, error, setError, signIn, openApp };
}
