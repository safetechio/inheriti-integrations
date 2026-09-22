export const chromeExtensionHost = Object.freeze({
  name: 'chrome-extension',
  contractVersion: 'elements.integration.v1',
  manifestVersion: 3 as const,
  persistentContentScript: false,
  activation: 'explicit-user-action' as const,
  environment: 'TEST' as const,
});
