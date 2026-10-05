import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, platform, arch } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const revision = 'bd59ef4c1c7af8b7ade0d473f3ab0d48b9f1d338';
const modelName = 'Qwen3-1.7B-Q4_K_M.gguf';
const modelHash = 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897';
const releases: Record<string, [string, string]> = {
  'linux-x64': ['ubuntu-x64.tar.gz', 'f95be64ec0b3fae6281d663e9a92016cf760b7c20b093e560d5e5420dadf7948'],
  'linux-arm64': ['ubuntu-arm64.tar.gz', 'ea37cb3038fb433558102075199efdbdc83a4af59fe72c9a3e06b777a62d08fd'],
  'darwin-arm64': ['mac-arm64.tar.gz', '9a19d064e1674f822f92549b08d22e8ae2eb4e94a64e99de2ae82cc4f76a0069'],
  'darwin-x64': ['mac-x64.tar.gz', 'ea97f4392f3b512297cc340987a2af2a093ff968a74bab1e6d1eadfc13078400'],
  'win32-x64': ['win-cpu-x64.zip', 'bdbb1ee5368b44112fa3fa9b3ac168a15d0d492e5c2f9fbe2074dd2f4628a4b9'],
  'win32-arm64': ['win-cpu-arm64.zip', 'f1787cf41e0baa186c65db659e3bd8a9b47eae31892d05b0435540f609edf5eb'],
};

export interface LocalAssistantInstallStatus {
  installed: boolean;
  executablePath: string;
  modelPath: string;
}

export interface LocalAssistantInstallProgress {
  phase: 'runtime' | 'model' | 'extract' | 'verify';
  downloadedBytes?: number;
  totalBytes?: number;
}

export function localAssistantPaths(root = join(homedir(), '.inheriti', 'local-assistant')): LocalAssistantInstallStatus {
  return { installed: false, executablePath: join(root, 'current', 'runtime', platform() === 'win32' ? 'llama-server.exe' : 'llama-server'), modelPath: join(root, 'current', modelName) };
}

export async function getLocalAssistantInstallStatus(root?: string): Promise<LocalAssistantInstallStatus> {
  const paths = localAssistantPaths(root);
  try {
    const marker = JSON.parse(await readFile(join(root ?? join(homedir(), '.inheriti', 'local-assistant'), 'current', 'complete.json'), 'utf8')) as { modelHash?: string; executableHash?: string };
    const installed = marker.modelHash === modelHash && typeof marker.executableHash === 'string'
      && await hashFile(paths.modelPath) === modelHash && await hashFile(paths.executablePath) === marker.executableHash;
    return { ...paths, installed };
  } catch { return paths; }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(url: string, destination: string, expectedHash: string, maxBytes: number, phase: 'runtime' | 'model', options: { signal?: AbortSignal; onProgress?: (progress: LocalAssistantInstallProgress) => void }): Promise<void> {
  options.onProgress?.({ phase, downloadedBytes: 0 });
  const response = await fetch(url, { signal: options.signal ?? null, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error('Local assistant download failed');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error('Local assistant download too large');
  const totalBytes = Number.isFinite(length) && length > 0 ? length : undefined;
  const hash = createHash('sha256');
  let bytes = 0;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxBytes) source.destroy(new Error('Local assistant download too large'));
    else {
      hash.update(chunk);
      options.onProgress?.({ phase, downloadedBytes: bytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
    }
  });
  await pipeline(source, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (hash.digest('hex') !== expectedHash) throw new Error('Local assistant checksum mismatch');
}

async function command(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, signal });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.length > 2_000_000) child.kill(); });
    child.once('error', () => fail(new Error('Local assistant archive unavailable')));
    child.once('close', (code) => code === 0 && output.length <= 2_000_000 ? done(output) : fail(new Error('Local assistant archive invalid')));
  });
}

async function findServer(directory: string, executable: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === executable) return path;
    if (entry.isDirectory()) { const nested = await findServer(path, executable); if (nested) return nested; }
  }
  return undefined;
}

/** Downloads pinned artifacts only when explicitly called. No model is bundled with CLI or MCP. */
export async function installLocalAssistant(options: { root?: string; signal?: AbortSignal; onProgress?: (progress: LocalAssistantInstallProgress) => void } = {}): Promise<LocalAssistantInstallStatus> {
  const release = releases[`${platform()}-${arch()}`];
  if (!release) throw new Error('Local assistant unsupported platform');
  const root = resolve(options.root ?? join(homedir(), '.inheriti', 'local-assistant'));
  const paths = localAssistantPaths(root);
  if ((await getLocalAssistantInstallStatus(root)).installed) return { ...paths, installed: true };
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await stat(join(root, 'current')).then(() => true, () => false)) throw new Error('Local assistant installation is incomplete or corrupt');
  const temp = join(root, `.install-${process.pid}-${Date.now()}`);
  await mkdir(temp, { mode: 0o700 });
  try {
    const archive = join(temp, basename(release[0]));
    const payload = join(temp, 'payload');
    await mkdir(payload, { mode: 0o700 });
    const model = join(payload, modelName);
    await download(`https://github.com/ggml-org/llama.cpp/releases/download/b10977/llama-b10977-bin-${release[0]}`, archive, release[1], 500_000_000, 'runtime', options);
    await download(`https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/${revision}/${modelName}`, model, modelHash, 2_000_000_000, 'model', options);
    options.onProgress?.({ phase: 'extract' });
    const entries = (await command(['-tf', archive], options.signal)).split(/\r?\n/).filter(Boolean);
    if (!entries.length || entries.some((entry) => entry.startsWith('/') || entry.startsWith('\\') || /^[A-Za-z]:/.test(entry) || entry.split(/[\\/]/).includes('..'))) throw new Error('Local assistant archive invalid');
    const extraction = join(temp, 'extracted');
    await mkdir(extraction, { mode: 0o700 });
    await command(['-xf', archive, '-C', extraction], options.signal);
    const server = await findServer(extraction, platform() === 'win32' ? 'llama-server.exe' : 'llama-server');
    if (!server) throw new Error('Local assistant executable missing');
    const runtime = join(payload, 'runtime');
    await rename(join(server, '..'), runtime);
    if (platform() !== 'win32') await chmod(join(runtime, 'llama-server'), 0o700);
    options.onProgress?.({ phase: 'verify' });
    await writeFile(join(payload, 'complete.json'), JSON.stringify({ modelHash, executableHash: await hashFile(join(runtime, platform() === 'win32' ? 'llama-server.exe' : 'llama-server')) }), { mode: 0o600, flag: 'wx' });
    await rename(payload, join(root, 'current'));
    return { ...paths, installed: true };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
