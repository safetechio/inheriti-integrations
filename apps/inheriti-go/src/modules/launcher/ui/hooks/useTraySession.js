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

  async function addAccount() {
    try {
      setError('');
      setState(await window.inheritiTray.addAccount());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.signInFailed);
    }
  }

  async function cancelAccountAuthorization() {
    try {
      setState(await window.inheritiTray.cancelAccountAuthorization());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.retryError);
    }
  }

  async function activateAccount(subject, organizationId) {
    try {
      setError('');
      let next = await window.inheritiTray.activateAccount(subject);
      setState(next);
      if (organizationId && next.organizations?.some(({ id }) => id === organizationId)) {
        try {
          next = await window.inheritiTray.select(organizationId);
          setState(next);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : messages.retryError);
        }
      } else if (organizationId) {
        setError('This organisation is no longer available for this account.');
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.retryError);
      return false;
    }
  }

  async function restore() {
    try {
      setError('');
      setState(await window.inheritiTray.restore());
    } catch {
      setError(messages.sessionUnavailable);
    }
  }

  async function openApp(planId) {
    try {
      await window.inheritiTray.openApp(planId);
    } catch {
      setError(messages.appUrlError);
    }
  }

  return { state, setState, error, setError, signIn, addAccount, cancelAccountAuthorization, activateAccount, restore, openApp };
}
