// Runs in MAIN world. It receives booleans only and has no runtime channel, so it cannot request or
// observe Plan Access tokens, keys, mappings, or plaintext.
(() => {
  const SETTINGS_EVENT = 'inheritiguard:settings';
  const BLOCKED_EVENT = 'inheritiguard:blocked';
  let settings = { protection: false, sensitiveApi: false, clipboard: false, allowPaste: true, allowRead: true };
  // This rejects blind/accidental page events, but MAIN-world code is ultimately page-observable
  // and a hostile page can undo JavaScript patches. Navigation/DNR remains the hard browser-owned
  // boundary; API and clipboard patches are defense in depth and must not be described otherwise.
  let bridgeNonce: string | undefined;
  const blocked = (kind: 'clipboard-blocked' | 'sensitive-api-blocked') =>
    document.dispatchEvent(new CustomEvent(BLOCKED_EVENT, { detail: { kind } }));
  const denied = (name: string) => {
    blocked('sensitive-api-blocked');
    return Promise.reject(new DOMException(`${name} is blocked by InheritiGuard.`, 'NotAllowedError'));
  };

  document.addEventListener(SETTINGS_EVENT, (event) => {
    const detail = (event as CustomEvent<{ nonce?: unknown; settings?: Partial<typeof settings> }>).detail;
    if (typeof detail?.nonce !== 'string' || detail.nonce.length < 20) return;
    if (bridgeNonce !== undefined && detail.nonce !== bridgeNonce) return;
    bridgeNonce = detail.nonce;
    const value = detail.settings;
    if (typeof value !== 'object' || value === null) return;
    settings = {
      protection: value.protection === true,
      sensitiveApi: value.sensitiveApi === true,
      clipboard: value.clipboard === true,
      allowPaste: value.allowPaste !== false,
      allowRead: value.allowRead !== false,
    };
  });

  const media = navigator.mediaDevices;
  if (media?.getUserMedia) {
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = (constraints) => settings.protection && settings.sensitiveApi
      ? denied('Camera and microphone access') : original(constraints);
  }
  if (media?.enumerateDevices) {
    const original = media.enumerateDevices.bind(media);
    media.enumerateDevices = () => settings.protection && settings.sensitiveApi
      ? denied('Device enumeration') : original();
  }
  const batteryNavigator = navigator as Navigator & { getBattery?: () => Promise<unknown> };
  if (batteryNavigator.getBattery) {
    const original = batteryNavigator.getBattery.bind(batteryNavigator);
    batteryNavigator.getBattery = () => settings.protection && settings.sensitiveApi
      ? denied('Battery status') : original();
  }
  if (navigator.serviceWorker?.register) {
    const original = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (scriptURL, options) => settings.protection && settings.sensitiveApi
      ? denied('Service worker registration') as Promise<ServiceWorkerRegistration>
      : original(scriptURL, options);
  }
  if (typeof Notification !== 'undefined' && Notification.requestPermission) {
    const original = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (callback?) => {
      if (!settings.protection || !settings.sensitiveApi) return original(callback);
      blocked('sensitive-api-blocked');
      callback?.('denied');
      return Promise.resolve('denied');
    };
  }
  if (navigator.geolocation) {
    const originalCurrent = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    const originalWatch = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (success, error, options) => {
      if (!settings.protection || !settings.sensitiveApi) return originalCurrent(success, error, options);
      blocked('sensitive-api-blocked');
      error?.({ code: 1, message: 'Geolocation is blocked by InheritiGuard.', PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    };
    navigator.geolocation.watchPosition = (success, error, options) => {
      if (!settings.protection || !settings.sensitiveApi) return originalWatch(success, error, options);
      blocked('sensitive-api-blocked');
      error?.({ code: 1, message: 'Geolocation is blocked by InheritiGuard.', PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      return 0;
    };
  }
  if (navigator.clipboard?.readText) {
    const original = navigator.clipboard.readText.bind(navigator.clipboard);
    navigator.clipboard.readText = () => settings.clipboard && !settings.allowRead
      ? (blocked('clipboard-blocked'), Promise.reject(new DOMException('Clipboard read blocked.', 'NotAllowedError')))
      : original();
  }
  if (navigator.clipboard?.read) {
    const original = navigator.clipboard.read.bind(navigator.clipboard);
    navigator.clipboard.read = () => settings.clipboard && !settings.allowRead
      ? (blocked('clipboard-blocked'), Promise.reject(new DOMException('Clipboard read blocked.', 'NotAllowedError')))
      : original();
  }
  document.addEventListener('paste', (event) => {
    if (settings.clipboard && !settings.allowPaste) {
      event.preventDefault();
      event.stopImmediatePropagation();
      blocked('clipboard-blocked');
    }
  }, true);
})();
