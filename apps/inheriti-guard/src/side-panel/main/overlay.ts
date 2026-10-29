import type { SidePanelRequest, SidePanelResponse } from '../../shared/messages.js';
import { compactButton, el, required } from './dom.js';

export function initializeOverlayPanel(send: (request: SidePanelRequest) => Promise<SidePanelResponse>): void {
  const origin = required('origin');
  const inspect = required<HTMLButtonElement>('inspect');
  const pickPageFieldButton = required<HTMLButtonElement>('pick-page-field');
  const overlayStatus = required('overlay-status');
  const overlayMessage = required('overlay-message');
  const enableOverlay = required<HTMLButtonElement>('enable-overlay');
  const disableOverlay = required<HTMLButtonElement>('disable-overlay');
  const authorizedSites = required<HTMLElement>('authorized-sites');
  const authorizedOriginList = required<HTMLUListElement>('authorized-origin-list');
  const disableAllOverlays = required<HTMLButtonElement>('disable-all-overlays');
  let currentOverlayOrigin: string | undefined;

  async function refreshActiveContext(): Promise<void> {
    const response = await send({ type: 'get-active-context' });
    const context = response.ok && 'context' in response ? response.context : undefined;
    if (context === undefined) {
      origin.textContent = 'Reopen the panel from the toolbar on a supported page.';
      inspect.disabled = true;
      pickPageFieldButton.disabled = true;
      return;
    }
    origin.textContent = context.origin;
    inspect.disabled = false;
    pickPageFieldButton.disabled = false;
  }

  /**
   * The panel outlives the tab it was opened on, and its whole page-facing half is about that one tab.
   * Left alone it keeps describing a page nobody is looking at any more — an origin it cannot act on,
   * or a "secure HTTPS sites only" line about a tab that was replaced. So the tab is re-read whenever
   * the browser says it changed, and whenever the panel comes back into view.
   */
  async function refreshPageState(): Promise<void> {
    await refreshActiveContext();
    await refreshOverlayPermissions();
  }

  void refreshPageState();
  chrome.tabs.onActivated.addListener(() => { void refreshPageState(); });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.status === 'complete' || changeInfo.url !== undefined) void refreshPageState(); });
  chrome.windows.onFocusChanged.addListener(() => { void refreshPageState(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshPageState(); });

  enableOverlay.addEventListener('click', () => { void enableOverlayForCurrentSite(); });
  disableOverlay.addEventListener('click', () => { void changeOverlayPermission('disable-overlay-origin', origin.textContent ?? ''); });
  disableAllOverlays.addEventListener('click', () => {
    disableAllOverlays.disabled = true;
    void changeOverlayPermission('disable-all-overlays').finally(() => { disableAllOverlays.disabled = false; });
  });

  async function refreshOverlayPermissions(): Promise<void> {
    const response = await send({ type: 'get-overlay-permissions' });
    if (response.ok && 'overlay' in response) renderOverlayPermissions(response.overlay);
  }

  async function enableOverlayForCurrentSite(): Promise<void> {
    const enabledOrigin = currentOverlayOrigin;
    if (enabledOrigin === undefined) return;
    // Chrome requires permissions.request() in the extension page's direct user gesture. A runtime
    // message to the worker does not preserve that activation.
    const granted = await chrome.permissions.request({ origins: [`${enabledOrigin}/*`] });
    if (!granted) {
      overlayStatus.textContent = 'Disabled'; overlayStatus.className = 'status neutral';
      overlayMessage.textContent = 'Site permission was not granted. Enable it to show autofill controls.';
      return;
    }
    await changeOverlayPermission('enable-overlay-current-origin');
  }

  async function changeOverlayPermission(
    type: 'enable-overlay-current-origin' | 'disable-overlay-origin' | 'disable-all-overlays',
    disabledOrigin?: string,
  ): Promise<void> {
    if (type === 'enable-overlay-current-origin') {
      overlayStatus.textContent = 'Updating'; overlayStatus.className = 'status busy';
    }
    const request = type === 'disable-overlay-origin'
      ? { type, origin: disabledOrigin ?? '' } as const
      : { type } as const;
    const response = await send(request).catch(() => undefined);
    const latest = await send({ type: 'get-overlay-permissions' }).catch(() => undefined);
    const state = latest?.ok && 'overlay' in latest ? latest.overlay
      : response?.ok && 'overlay' in response ? response.overlay : undefined;
    if (state !== undefined) {
      renderOverlayPermissions(state);
      const completed = type === 'disable-all-overlays' ? state.enabledOrigins.length === 0
        : type === 'disable-overlay-origin' ? !state.enabledOrigins.includes(disabledOrigin ?? '')
          : state.currentEnabled;
      if (completed) return;
    }
    overlayStatus.textContent = 'Needs attention'; overlayStatus.className = 'status neutral';
    overlayMessage.textContent = 'Could not update site access. Try again.';
  }

  function renderOverlayPermissions(state: { currentOrigin?: string; currentEnabled: boolean; enabledOrigins: readonly string[] }): void {
    currentOverlayOrigin = state.currentOrigin;
    const supported = state.currentOrigin !== undefined;
    if (state.currentOrigin !== undefined && origin.textContent?.startsWith('Checking')) origin.textContent = state.currentOrigin;
    overlayStatus.textContent = state.currentEnabled ? 'Enabled' : 'Disabled';
    overlayStatus.className = `status ${state.currentEnabled ? 'success' : 'neutral'}`;
    overlayMessage.textContent = !supported
      ? 'Autofill controls require a secure HTTPS site.'
      : state.currentEnabled
        ? 'Inheriti controls are enabled beside compatible fields on this origin.'
        : 'Enable site access to show autofill controls beside compatible fields.';
    enableOverlay.hidden = !supported || state.currentEnabled;
    disableOverlay.hidden = !state.currentEnabled;
    authorizedSites.hidden = state.enabledOrigins.length === 0;
    authorizedOriginList.replaceChildren(...state.enabledOrigins.map((enabledOrigin) => {
      const item = el('li'); item.append(document.createTextNode(enabledOrigin));
      const revoke = compactButton('Disable'); revoke.classList.add('danger');
      revoke.addEventListener('click', () => {
        revoke.disabled = true;
        revoke.textContent = 'Disabling…';
        void changeOverlayPermission('disable-overlay-origin', enabledOrigin).finally(() => {
          revoke.disabled = false; revoke.textContent = 'Disable';
        });
      });
      item.append(revoke); return item;
    }));
  }

}
