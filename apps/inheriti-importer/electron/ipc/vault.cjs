const { dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { handle } = require('../lib/ipc-guard.cjs');

function register(sessionsReady) {
  handle('vault:openFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import password database',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Supported vaults',
          extensions: ['kdbx', '1pux', 'json', 'csv', 'yaml', 'yml', 'env'],
        },
        { name: 'KeePass', extensions: ['kdbx'] },
        { name: '1Password', extensions: ['1pux'] },
        { name: 'Passbolt', extensions: ['json', 'csv'] },
        { name: 'Kubernetes', extensions: ['yaml', 'yml', 'json'] },
        { name: 'HashiCorp Vault', extensions: ['json', 'yaml', 'yml'] },
        { name: 'dotenv', extensions: ['env'] },
        { name: 'Cloud', extensions: ['json'] },
      ],
    });

    if (result.canceled) return [];

    // GTK's file chooser can report the same path twice when a file is
    // double-clicked to select and confirm in one action.
    const filePaths = [...new Set(result.filePaths)];

    return Promise.all(
      filePaths.map(async (filePath) => ({
        name: path.basename(filePath),
        path: filePath,
        data: Array.from(await fs.readFile(filePath)),
      })),
    );
  });
}

module.exports = { register };
