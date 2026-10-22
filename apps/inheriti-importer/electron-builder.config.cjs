const { resolve } = require('node:path');

const environments = new Set(['dev', 'stg', 'prod']);
const environment = process.env.INHERITI_RELEASE_ENV;
const baseVersion = require('./package.json').version.replace(/-(?:dev|stg)\.\d+$/, '');

if (!environments.has(environment)) {
  throw new Error('INHERITI_RELEASE_ENV must be one of: dev, stg, prod');
}

module.exports = {
  icon: resolve(__dirname, 'public/icon.svg'),
  appId:
    environment === 'prod'
      ? 'io.safetech.inheriti.importer'
      : `io.safetech.inheriti.importer.${environment}`,
  productName:
    environment === 'prod' ? 'Inheriti Importer' : `Inheriti Importer ${environment.toUpperCase()}`,
  artifactName: `Inheriti-Importer-${environment === 'prod' ? '' : `${environment}-`}\${version}-\${os}-\${arch}.\${ext}`,
  extraMetadata: {
    version: environment === 'prod' ? baseVersion : `${baseVersion}-${environment}.0`,
  },
  directories: {
    output: `release/${environment}`,
  },
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  linux: {
    category: 'Utility',
    syncDesktopName: true,
    target: ['AppImage'],
  },
  mac: {
    category: 'public.app-category.utilities',
    target: ['dmg'],
    notarize: true,
    hardenedRuntime: true,
  },
  win: {
    target: ['nsis'],
  },
};
