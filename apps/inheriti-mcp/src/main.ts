#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node';
import { lockedDeployment, MetadataTools, runServer } from './server.js';

function npmCommand(file: string): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: 'npm', args: ['install', '--global', file] };
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const script = candidates.find((candidate) => candidate && isAbsolute(candidate) && candidate.endsWith('npm-cli.js') && existsSync(candidate));
  if (!script) throw new Error('npm-cli.js is unavailable. Install npm with Node.js and retry.');
  return { command: process.execPath, args: [script, 'install', '--global', file] };
}

async function update(install: boolean): Promise<void> {
  if (!lockedDeployment) throw new Error('Updates require a channel-locked Business build.');
  const version = (JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  const core = await new MetadataTools().updateAccess((uri, code) => process.stderr.write(`Sign in at ${uri} with code ${code}\n`));
  const build = latestIntegrationBuild(await core.listInternalBuilds(), 'mcp', version, `${process.platform}-${process.arch}`);
  if (!build) { process.stderr.write(`Inheriti MCP ${version} is up to date.\n`); return; }
  process.stderr.write(`Inheriti MCP ${version} → ${build.version}\n`);
  if (!install) { process.stderr.write('Run inheriti-mcp update --install to install it.\n'); return; }
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('Update installation requires an interactive terminal.');
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  let answer: string;
  try { answer = await prompt.question('Install this update? [y/N] '); }
  finally { prompt.close(); }
  if (!/^(y|yes)$/iu.test(answer.trim())) return;
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-mcp-update-'));
  try {
    const { url } = await core.requestInternalBuildDownload(build.id);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error('Update download failed.');
    const path = join(directory, 'inheriti-mcp.tgz');
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
    const npm = npmCommand(path);
    const result = spawnSync(npm.command, npm.args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm install exited with status ${result.status}.`);
    process.stderr.write(`Installed Inheriti MCP ${build.version}. Restart the MCP server to use it.\n`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const args = process.argv.slice(2);
if (args[0] === 'update' && (args.length === 1 || (args.length === 2 && args[1] === '--install'))) {
  update(args.includes('--install')).catch(() => { process.stderr.write('update_failed\n'); process.exitCode = 1; });
} else if (args.length === 0 || (args.length === 1 && args[0] === '--local-delivery')) {
  runServer(args.includes('--local-delivery')).catch(() => { process.stderr.write('server_start_failed\n'); process.exitCode = 1; });
} else {
  process.stderr.write('Usage: inheriti-mcp [--local-delivery] | update [--install]\n');
  process.exitCode = 1;
}
