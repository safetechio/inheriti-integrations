import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';

export async function notifyCliUpdate(context: CliContext, terminal: Terminal, version: string, sessionPath: string): Promise<void> {
  if (!terminal.interactive || !(await context.sessions.load())) return;
  const marker = `${sessionPath}.update-check`;
  try { if (Date.now() - (await stat(marker)).mtimeMs < 24 * 60 * 60 * 1000) return; } catch { /* First check. */ }
  try {
    await writeFile(marker, '', { mode: 0o600 });
    const build = latestIntegrationBuild(await context.core.listInternalBuilds(), 'cli', version, `${process.platform}-${process.arch}`);
    if (build) terminal.writeError(`Inheriti CLI ${build.version} is available. Run inheriti update --install.`);
  } catch { /* An update notice must never fail the command. */ }
}

function npmCommand(file: string): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npm', args: ['install', '--global', file] };
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const script = candidates.find((candidate) => candidate && isAbsolute(candidate) && candidate.endsWith('npm-cli.js') && existsSync(candidate));
  if (!script) throw new Error('npm-cli.js is unavailable. Install npm with Node.js and retry.');
  return { command: process.execPath, args: [script, 'install', '--global', file] };
}

export async function updateCli(context: CliContext, terminal: Terminal, version: string, install: boolean): Promise<number> {
  const build = latestIntegrationBuild(await context.core.listInternalBuilds(), 'cli', version, `${process.platform}-${process.arch}`);
  if (!build) { terminal.write(`Inheriti CLI ${version} is up to date.`); return 0; }
  terminal.write(`Inheriti CLI ${version} → ${build.version}`);
  if (!install) { terminal.write('Run inheriti update --install to install it.'); return 0; }
  if (!terminal.interactive) { terminal.writeError('Update installation requires an interactive terminal.'); return 1; }
  const { promptSelect } = await import('../render/select.jsx');
  if (await promptSelect('Install this update?', [{ value: 'yes', description: 'Install' }, { value: 'no', description: 'Cancel' }]) !== 'yes') return 0;
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-update-'));
  try {
    const { url } = await context.core.requestInternalBuildDownload(build.id);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Update download failed.');
    const file = join(directory, 'inheriti-cli.tgz');
    if (!response.body) throw new Error('Update download failed.');
    const target = await open(file, 'wx', 0o600);
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
    const npm = npmCommand(file);
    const result = spawnSync(npm.command, npm.args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm install exited with status ${result.status}.`);
    terminal.write(`Installed Inheriti CLI ${build.version}. Start a new terminal session to use it.`);
    return 0;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
