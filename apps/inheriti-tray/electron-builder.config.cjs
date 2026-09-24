const { resolve } = require('node:path');

const deployment = process.env.INHERITI_BUILD_DEPLOYMENT;
if (!['local', 'dev', 'stg', 'prod'].includes(deployment)) {
  throw new Error('INHERITI_BUILD_DEPLOYMENT must be local, dev, stg, or prod.');
}

module.exports = {
  appId: `com.safetech.inheriti.tray.${deployment}`,
  productName: deployment === 'prod' ? 'Inheriti Tray' : `Inheriti Tray ${deployment.toUpperCase()}`,
  executableName: 'inheriti-tray',
  artifactName: `Inheriti-Tray-${deployment}-\${version}-\${os}-\${arch}.\${ext}`,
  directories: { output: process.env.INHERITI_ARTIFACTS_DIR ?? `artifacts/${deployment}` },
  files: ['dist/**/*', 'package.json'],
  asar: false,
  linux: { category: 'Utility', target: ['AppImage'], icon: resolve(__dirname, 'src/tray.png'), syncDesktopName: true },
  mac: {
    category: 'public.app-category.utilities',
    target: ['dmg'],
    notarize: deployment === 'prod',
    hardenedRuntime: true,
    entitlements: resolve(__dirname, 'build/entitlements.mac.plist'),
    entitlementsInherit: resolve(__dirname, 'build/entitlements.mac.plist'),
  },
  win: { target: ['nsis'] },
};
