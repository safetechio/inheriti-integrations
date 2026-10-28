const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function callbackPage(success) {
  const appRoot = path.resolve(__dirname, '../../..');
  const assetsRoot = app.isPackaged ? path.join(appRoot, 'dist') : appRoot;
  const fontPath = app.isPackaged
    ? path.join(assetsRoot, 'font-app.ttf')
    : path.join(appRoot, '../../packages/core/assets/font-app.ttf');
  const logoPath = path.join(assetsRoot, app.isPackaged ? 'favicon.png' : 'public/favicon.png');
  return fs
    .readFileSync(path.join(__dirname, '../login-callback.html'), 'utf8')
    .replace('{{font}}', fs.readFileSync(fontPath).toString('base64'))
    .replace('{{logo}}', fs.readFileSync(logoPath).toString('base64'))
    .replaceAll('{{heading}}', success ? 'Continue in Inheriti® Importer' : 'Sign-in failed')
    .replace('{{statusLabel}}', success ? 'Browser step complete' : 'Sign-in error')
    .replace('{{statusClass}}', success ? '' : 'failed')
    .replace(
      '{{message}}',
      success
        ? 'You can close this tab and return to Inheriti® Importer to finish signing in.'
        : 'Return to Inheriti® Importer and try signing in again.',
    );
}

module.exports = { callbackPage };
