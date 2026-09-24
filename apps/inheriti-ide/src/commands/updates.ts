import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node';
import { BUILD_DEPLOYMENT } from '../configuration.js';
import type { CommandContext } from './context.js';

export async function notifyUpdate(deps: CommandContext): Promise<void> {
  const { context, sessions, core } = deps;
  if (!BUILD_DEPLOYMENT || !(await sessions.load())) return;
  const version = String(context.extension.packageJSON.version);
  const key = `inheriti.updateChecked.${version}`;
  if (Date.now() - context.globalState.get<number>(key, 0) < 24 * 60 * 60 * 1000) return;
  await context.globalState.update(key, Date.now());
  try {
    const build = latestIntegrationBuild(await core(false).listInternalBuilds(), 'ide', version, 'all');
    if (build) void vscode.window.showInformationMessage(`Inheriti IDE ${build.version} is available.`, 'Install').then((choice) => {
      if (choice === 'Install') void vscode.commands.executeCommand('inheriti.checkUpdate');
    });
  } catch { /* The extension still works if the catalog is unavailable. */ }
}

export function registerUpdateCommands(deps: CommandContext): vscode.Disposable[] {
  const { context, core } = deps;
  return [
    vscode.commands.registerCommand('inheriti.showVersion', async () => {
      await vscode.window.showInformationMessage(`Inheriti IDE ${context.extension.packageJSON.version}`);
    }),
    vscode.commands.registerCommand('inheriti.checkUpdate', async () => {
      const version = String(context.extension.packageJSON.version);
      if (!BUILD_DEPLOYMENT) { await vscode.window.showInformationMessage(`Inheriti IDE ${version}: updates require a channel-locked build.`); return; }
      try {
        const build = latestIntegrationBuild(await core(false).listInternalBuilds(), 'ide', version, 'all');
        if (!build) { await vscode.window.showInformationMessage(`Inheriti IDE ${version} is up to date.`); return; }
        const choice = await vscode.window.showInformationMessage(`Inheriti IDE ${build.version} is available. Install and reload VS Code to use it.`, 'Install');
        if (choice !== 'Install') return;
        const directory = await mkdtemp(join(tmpdir(), 'inheriti-ide-update-'));
        try {
          const { url } = await core(false).requestInternalBuildDownload(build.id);
          const response = await fetch(url);
          if (!response.ok) throw new Error('Update download failed.');
          const path = join(directory, 'inheriti-ide.vsix');
          if (!response.body) throw new Error('Update download failed.');
          const target = await open(path, 'wx', 0o600);
          const hash = createHash('sha256');
          let size = 0;
          try {
            const reader = response.body.getReader();
            while (true) {
              const { done, value: chunk } = await reader.read();
              if (done) break;
              size += chunk.length;
              if (size > build.size) throw new Error('Update integrity check failed.');
              hash.update(chunk);
              for (let offset = 0; offset < chunk.length;) offset += (await target.write(chunk, offset)).bytesWritten;
            }
          } finally { await target.close(); }
          if (size !== build.size || hash.digest('hex') !== build.checksum) throw new Error('Update integrity check failed.');
          await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(path));
          await vscode.window.showInformationMessage(`Inheriti IDE ${build.version} installed. Reload the window to use it.`, 'Reload').then(async (action) => {
            if (action === 'Reload') await vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      } catch {
        await vscode.window.showErrorMessage('Inheriti IDE update failed. Check your connection and retry.');
      }
    }),
  ];
}
