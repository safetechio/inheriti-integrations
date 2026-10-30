import { useEffect, useState } from 'react';
import { sessionErrorMessage } from '../../../../messages.js';

export function useTraySession(messages) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const stop = window.inheritiTray.onStateChanged(setState);
    void window.inheritiTray.state()
      .then(setState)
      .catch((cause) => setError(sessionErrorMessage(cause, messages.sessionUnavailable)));
    return stop;
  }, [messages]);

  async function signIn() {
    try {
      setError('');
      setState(await window.inheritiTray.signIn());
    } catch (cause) {
      setError(sessionErrorMessage(cause, messages.signInFailed));
    }
  }

  async function addAccount() {
    try {
      setError('');
      const next = await window.inheritiTray.addAccount();
      setState(next);
      return next;
    } catch (cause) {
      setError(sessionErrorMessage(cause, messages.signInFailed));
      return null;
    }
  }

  async function cancelAccountAuthorization() {
    try {
      setState(await window.inheritiTray.cancelAccountAuthorization());
    } catch (cause) {
      setError(sessionErrorMessage(cause, messages.sessionUnavailable));
    }
  }

  async function activateAccount(subject, organizationId) {
    try {
      setError('');
      let next = await window.inheritiTray.activateAccount(subject);
      setState(next);
      if (next.activeSubject !== subject || next.status !== 'signed-in') return false;
      if (organizationId && next.organizations?.some(({ id }) => id === organizationId)) {
        try {
          next = await window.inheritiTray.select(organizationId);
          setState(next);
          return next.activeSubject === subject && next.selectedId === organizationId;
        } catch (cause) {
          setError(sessionErrorMessage(cause, messages.sessionUnavailable));
          return false;
        }
      } else if (organizationId) {
        setError('This organisation is no longer available for this account.');
        return false;
      }
      return true;
    } catch (cause) {
      setError(sessionErrorMessage(cause, messages.sessionUnavailable));
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

  async function signOutAll() {
    try {
      setError('');
      setState(await window.inheritiTray.signOutAll());
      return true;
    } catch (cause) {
      setError(sessionErrorMessage(cause, messages.sessionUnavailable));
      return false;
    }
  }

  async function removeAccount(subject) {
    try {
      setError('');
      setState(await window.inheritiTray.removeAccount(subject));
      return true;
    } catch (cause) {
      setError(sessionErrorMessage(cause, messages.sessionUnavailable));
      return false;
    }
  }

  async function openApp(planId) {
    try {
      await window.inheritiTray.openApp(planId);
    } catch {
      setError(messages.appUrlError);
    }
  }

  return { state, setState, error, setError, signIn, addAccount, cancelAccountAuthorization, activateAccount, restore, signOutAll, removeAccount, openApp };
}
