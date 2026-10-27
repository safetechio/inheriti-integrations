import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node-base';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node-base';

/** 0: current or signed out, 1: blocked, 2: installed; rerun the original command. */
export async function requireCliUpdate(context: CliContext, terminal: Terminal, version: string): Promise<0 | 1 | 2> {
  if (!(await context.sessions.load())) return 0;
  let build: InternalBuild | undefined;
  try { build = latestIntegrationBuild(await context.core.listInternalBuilds(), 'cli', version, `${process.platform}-${process.arch}`); }
  catch (error) {
    const failure = error as { status?: unknown; code?: unknown } | null;
    const status = failure?.status;
    if (status === 401) throw Object.assign(new Error('operator_reauthentication_required'), { code: 'operator_reauthentication_required' });
    if (status === 403 || ['operator_reauthentication_required', 'operator_not_signed_in', 'reauthentication_required'].includes(String(failure?.code))) throw error;
    terminal.writeError('Could not check for a required update. Retry when Inheriti Business is available.');
    return 1;
  }
  return build ? installCliBuild(context, terminal, version, build, true, true) : 0;
}

function npmCommand(file: string): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npm', args: ['install', '--global', '--loglevel=error', '--progress=true', file] };
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const script = candidates.find((candidate) => candidate && isAbsolute(candidate) && candidate.endsWith('npm-cli.js') && existsSync(candidate));
  if (!script) throw new Error('npm-cli.js is unavailable. Install npm with Node.js and retry.');
  return { command: process.execPath, args: [script, 'install', '--global', '--loglevel=error', '--progress=true', file] };
}

export async function updateCli(context: CliContext, terminal: Terminal, version: string, install: boolean): Promise<number> {
  const build = latestIntegrationBuild(await context.core.listInternalBuilds(), 'cli', version, `${process.platform}-${process.arch}`);
  if (!build) { terminal.write(`Inheriti CLI ${version} is up to date.`); return 0; }
  return installCliBuild(context, terminal, version, build, install);
}

async function installCliBuild(context: CliContext, terminal: Terminal, version: string, build: InternalBuild, install: boolean, required = false): Promise<0 | 1 | 2> {
  (required ? terminal.writeError : terminal.write)(`Inheriti CLI ${version} → ${build.version}`);
  if (!install) { terminal.write('Run inheriti update --install to install it.'); return 0; }
  if (!terminal.interactive) {
    terminal.writeError(required
      ? 'An update is required. Run `inheriti update --install` in an interactive terminal, then retry.'
      : 'Update installation requires an interactive terminal.');
    return 1;
  }
  const { promptSelect } = await import('../render/select.jsx');
  if (await promptSelect(required ? 'Update required. Install now?' : 'Install this update?', [{ value: 'yes', description: 'Install' }, { value: 'no', description: 'Cancel' }]) !== 'yes') {
    if (required) terminal.writeError('Update required. Run `inheriti update --install` to continue.');
    return required ? 1 : 0;
  }
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-update-'));
  const region = terminal.createLiveRegion?.();
  const started = Date.now();
  let phase = 'Connecting';
  let size = 0;
  let shownPercent = -1;
  let tick = 0;
  const draw = () => region?.update(`${['⠋', '⠙', '⠹', '⠸'][tick++ % 4]} ${phase} · ${Math.floor((Date.now() - started) / 1000)}s`);
  const timer = region ? setInterval(draw, 180) : undefined;
  timer?.unref();
  let progressClosed = false;
  const closeProgress = () => {
    if (progressClosed) return;
    progressClosed = true;
    if (timer) clearInterval(timer);
    region?.update('');
    region?.close();
  };
  draw();
  try {
    const { url } = await context.core.requestInternalBuildDownload(build.id);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Update download failed.');
    const file = join(directory, 'inheriti-cli.tgz');
    if (!response.body) throw new Error('Update download failed.');
    const target = await open(file, 'wx', 0o600);
    const hash = createHash('sha256');
    phase = 'Downloading 0%';
    draw();
    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.length;
        if (size > build.size) throw new Error('Update integrity check failed.');
        const percent = Math.min(100, Math.floor(size / build.size * 100));
        if (percent !== shownPercent) { shownPercent = percent; phase = `Downloading ${percent}%`; draw(); }
        hash.update(chunk);
        for (let offset = 0; offset < chunk.length;) offset += (await target.write(chunk, offset)).bytesWritten;
      }
    } finally { await target.close(); }
    phase = 'Verifying package';
    draw();
    if (size !== build.size || hash.digest('hex') !== build.checksum) throw new Error('Update integrity check failed.');
    const npm = npmCommand(file);
    closeProgress();
    terminal.write('Installing with npm...');
    const result = spawnSync(npm.command, npm.args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm install exited with status ${result.status}.`);
    const entrypoint = fileURLToPath(import.meta.url);
    if (basename(entrypoint) === 'main.js' && process.argv[1]) {
      try {
        if (realpathSync(process.argv[1]) !== entrypoint) throw new Error('CLI entrypoint changed');
        const refreshed = spawnSync(process.execPath, [entrypoint, '__skill-install'], { stdio: 'inherit' });
        if (refreshed.error || refreshed.status !== 0) throw refreshed.error ?? new Error('Skill reconciliation failed');
      } catch { terminal.writeError('CLI installed; its skill will be reconciled on the next CLI command.'); }
    }
  } finally {
    closeProgress();
    await rm(directory, { recursive: true, force: true });
  }
  terminal.write(`Installed Inheriti CLI ${build.version}. ${required ? 'Rerun your command to use it.' : 'Start a new terminal session to use it.'}`);
  return required ? 2 : 0;
}
