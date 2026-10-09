const { resolve } = require('node:path');

const deployment = process.env.INHERITI_BUILD_DEPLOYMENT;
if (!['local', 'dev', 'stg', 'prod'].includes(deployment)) {
  throw new Error('INHERITI_BUILD_DEPLOYMENT must be local, dev, stg, or prod.');
}

const productName = deployment === 'prod' ? 'Inheriti® Go' : `Inheriti® Go ${deployment.toUpperCase()}`;

module.exports = {
  appId: `com.safetech.inheriti.go.${deployment}`,
  productName,
  extraMetadata: { productName },
  icon: resolve(__dirname, deployment === 'prod' ? 'build/icon.svg' : `build/icon-${deployment}.svg`),
  artifactName: `Inheriti-Go-${deployment}-\${version}-\${os}-\${arch}.\${ext}`,
  directories: { output: process.env.INHERITI_ARTIFACTS_DIR ?? `artifacts/${deployment}` },
  files: ['dist/**/*', 'package.json'],
  asar: false,
  linux: { category: 'Utility', target: ['AppImage'], icon: resolve(__dirname, deployment === 'prod' ? 'src/tray.png' : `build/tray-${deployment}.png`), executableName: 'inheriti-go', executableArgs: ['--ozone-platform=x11'], syncDesktopName: true },
  mac: {
    category: 'public.app-category.utilities',
    target: ['dmg'],
    notarize: true,
    hardenedRuntime: true,
    entitlements: resolve(__dirname, 'build/entitlements.mac.plist'),
    entitlementsInherit: resolve(__dirname, 'build/entitlements.mac.plist'),
  },
  win: { target: ['nsis'] },
};
