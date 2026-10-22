const { resolve, join } = require('node:path');
const { rename, writeFile } = require('node:fs/promises');

const deployment = process.env.INHERITI_BUILD_DEPLOYMENT;
if (!['local', 'dev', 'stg', 'prod'].includes(deployment)) {
  throw new Error('INHERITI_BUILD_DEPLOYMENT must be local, dev, stg, or prod.');
}

const productName = deployment === 'prod' ? 'Inheriti® Go' : `Inheriti® Go ${deployment.toUpperCase()}`;

module.exports = {
  appId: `com.safetech.inheriti.go.${deployment}`,
  productName,
  extraMetadata: { productName, desktopName: `inheriti-go-${deployment}` },
  afterPack: async ({ electronPlatformName, appOutDir }) => {
    if (electronPlatformName !== 'linux') return;
    const launcher = join(appOutDir, 'inheriti-go');
    await rename(launcher, `${launcher}-bin`);
    await writeFile(launcher, '#!/bin/sh\n' +
      'binary="$(dirname "$0")/inheriti-go-bin"\n' +
      'if [ -n "$DISPLAY" ]; then\n' +
      '  for arg in "$@"; do case "$arg" in --ozone-platform=*) exec "$binary" "$@";; esac; done\n' +
      '  exec "$binary" --ozone-platform=x11 "$@"\n' +
      'fi\nexec "$binary" "$@"\n', { mode: 0o755 });
  },
  icon: resolve(__dirname, deployment === 'prod' ? 'build/icon.svg' : `build/icon-${deployment}.svg`),
  artifactName: `Inheriti-Go-${deployment === 'prod' ? '' : `${deployment}-`}\${version}-\${os}-\${arch}.\${ext}`,
  directories: { output: process.env.INHERITI_ARTIFACTS_DIR ?? `artifacts/${deployment}` },
  files: ['dist/**/*', 'package.json'],
  asar: false,
  linux: { category: 'Utility', target: ['AppImage'], icon: resolve(__dirname, deployment === 'prod' ? 'src/tray.png' : `build/tray-${deployment}.png`), executableName: 'inheriti-go', executableArgs: ['--ozone-platform=x11'], syncDesktopName: true },
  mac: {
    category: 'public.app-category.utilities',
    target: ['dmg', 'zip'],
    extendInfo: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
    notarize: true,
    hardenedRuntime: true,
    entitlements: resolve(__dirname, 'build/entitlements.mac.plist'),
    entitlementsInherit: resolve(__dirname, 'build/entitlements.mac.plist'),
  },
  win: { target: ['nsis'] },
};
