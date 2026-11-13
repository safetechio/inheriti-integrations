export const localPlanSessionScript = `
  let renewingSession = false;
  let lastSessionRenewal = Date.now();
  window.updateLocalPlanSession = () => {
    const main = document.querySelector('main[data-session-expires-at]');
    const notice = main?.querySelector('[data-session-notice]');
    if (!notice || main.querySelector('[aria-busy=true]:not([data-continue-session])')) return;
    const remaining = Number(main.dataset.sessionExpiresAt) - Date.now();
    const expired = remaining <= 0;
    notice.hidden = remaining > 120000;
    notice.querySelector('[data-session-message]').textContent = expired
      ? 'Session paused after inactivity. Continue the session to keep working. Your fields are still here.'
      : 'Session pauses in ' + Math.ceil(remaining / 60000) + ' min without activity. Continue the session to keep working.';
    for (const control of main.querySelectorAll('input, textarea, select, button')) {
      if (control.closest('.cancel-form') || control.matches('[data-continue-session]')) continue;
      if (expired && !control.disabled) { control.dataset.sessionDisabled = ''; control.disabled = true; }
      if (!expired && control.hasAttribute('data-session-disabled')) { delete control.dataset.sessionDisabled; control.disabled = false; }
    }
    if (expired) main.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  };
  const renewLocalPlanSession = async (explicit = false) => {
    const main = document.querySelector('main[data-session-expires-at]');
    if (!main || renewingSession || main.querySelector('[aria-busy=true]:not([data-continue-session])')) return;
    if (!explicit && (Date.now() >= Number(main.dataset.sessionExpiresAt) || Date.now() - lastSessionRenewal < 60000)) return;
    const form = main.querySelector('.cancel-form');
    const button = main.querySelector('[data-continue-session]');
    renewingSession = true;
    if (explicit) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try {
      const response = await fetch(form.getAttribute('action'), { method: 'POST', credentials: 'same-origin',
        body: new URLSearchParams({ csrf: form.elements.namedItem('csrf').value, action: 'keep-alive' }) });
      if (!response.ok) throw new Error('Session unavailable');
      const result = await response.json();
      main.dataset.sessionExpiresAt = String(result.expiresAt);
      lastSessionRenewal = Date.now();
      main.querySelector('[data-session-error]').textContent = '';
    } catch {
      if (explicit) {
        main.querySelector('[data-session-notice]').hidden = false;
        main.querySelector('[data-session-error]').textContent = 'Could not continue the session. Check the local connection and try again. Your fields have been kept.';
      }
    } finally {
      renewingSession = false;
      if (explicit) { button.disabled = false; button.removeAttribute('aria-busy'); }
      window.updateLocalPlanSession();
    }
  };
  for (const type of ['input', 'keydown', 'pointerdown']) document.addEventListener(type, event => {
    if (!event.target.closest?.('[data-continue-session]') && !document.hidden) void renewLocalPlanSession();
  });
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-continue-session]')) void renewLocalPlanSession(true);
  });
  setInterval(window.updateLocalPlanSession, 1000);
  window.updateLocalPlanSession();
`;
