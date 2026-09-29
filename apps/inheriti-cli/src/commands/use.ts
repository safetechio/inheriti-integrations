import { spawn } from 'node:child_process';
import type { ChildProcess, StdioOptions } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { consumePlanFields, loadRevealPlan, renderRequestedValue } from './reveal.js';

export interface UsePlanOptions {
  stdin?: string;
  envs: ReadonlyArray<{ name: string; selector: string }>;
  tempFiles: ReadonlyArray<{ name: string; selector: string }>;
  sockets: ReadonlyArray<{ name: string; selector: string }>;
  fds: ReadonlyArray<{ fd: number; selector: string }>;
  command: readonly string[];
  ttlMs?: number;
  /** Keep the child's normal output visible. Secret values are still never printed by the CLI itself. */
  output?: 'suppress' | 'inherit';
  signal?: AbortSignal;
}

export class UsePlanInvalid extends Error {
  readonly code = 'use_plan_invalid';
  constructor(message: string) { super(message); this.name = 'UsePlanInvalid'; }
}

export async function usePlan(
  context: CliContext,
  terminal: Terminal,
  planId: string,
  options: UsePlanOptions,
): Promise<number> {
  validateUseOptions(options);
  const deadline = deadlineSignal(options.signal, options.ttlMs);
  let lifecycle: ProcessLifecycle | undefined;
  try {
    assertActive(deadline.signal);
    const plan = await loadRevealPlan(context, planId);
    assertActive(deadline.signal);
    const available = new Set(plan.assets.flatMap((asset) =>
      (asset.fieldNames ?? []).map((field) => `${asset.code ?? asset.id}.${field}`)));
    const fields = [
      ...(options.stdin === undefined ? [] : [{ selector: options.stdin, action: 'USE_FIELD' as const, destination: 'STDIN' as const }]),
      ...options.envs.map(({ selector }) => ({ selector, action: 'USE_FIELD' as const, destination: 'ENVIRONMENT' as const })),
      ...options.tempFiles.map(({ selector }) => ({ selector, action: 'USE_FIELD' as const, destination: 'TEMPORARY_FILE' as const })),
      ...options.sockets.map(({ selector }) => ({ selector, action: 'USE_FIELD' as const, destination: 'LOCAL_SOCKET' as const })),
      ...options.fds.map(({ selector }) => ({ selector, action: 'USE_FIELD' as const, destination: 'FILE_DESCRIPTOR' as const })),
    ];
    const selectors = fields.map(({ selector }) => selector);
    const unknown = selectors.find((selector) => !available.has(selector));
    if (unknown) throw new UsePlanInvalid(`Unknown plan field: ${unknown}`);

    await consumePlanFields(context, terminal, planId, plan, fields, deadline.signal, async (consumed) => {
      const values = new Map(consumed.map(({ selector, value }) => [selector, renderRequestedValue(value)]));
      try { lifecycle = await executeWithSecrets(options, values, deadline.signal); }
      finally { values.clear(); }
    }, { onSession: deadline.session });
    if (lifecycle) await lifecycle.wait();
    assertActive(deadline.signal);
  } catch (error) {
    const expiration = deadline.expired();
    if (expiration) throw Object.assign(new Error(expiration, { cause: error }), { code: expiration });
    assertActive(deadline.signal);
    throw error;
  } finally {
    try { await lifecycle?.close(); } finally { deadline.close(); }
  }
  terminal.write('Command completed. Secret values were not printed by Inheriti.');
  return 0;
}

function validateUseOptions(options: UsePlanOptions): void {
  if (options.command.length === 0 || !options.command[0]?.trim()) throw new UsePlanInvalid('Pass an executable after --.');
  if (options.stdin === undefined && options.envs.length === 0 && options.tempFiles.length === 0
    && options.sockets.length === 0 && options.fds.length === 0) {
    throw new UsePlanInvalid('Choose --stdin, --env, --temp-file, --socket, or at least one --fd mapping.');
  }
  const environmentNames = new Set<string>();
  for (const mapping of [...options.envs, ...options.tempFiles, ...options.sockets]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(mapping.name)) {
      throw new UsePlanInvalid(`Invalid environment variable name: ${mapping.name}`);
    }
    if (environmentNames.has(mapping.name)) throw new UsePlanInvalid(`Environment variable ${mapping.name} is mapped more than once.`);
    environmentNames.add(mapping.name);
  }
  if (process.platform === 'win32' && (options.fds.length > 0 || options.sockets.length > 0)) throw new UsePlanInvalid('Dedicated descriptors and local sockets are unsupported on Windows.');
  const descriptors = new Set<number>();
  for (const mapping of options.fds) {
    if (!Number.isInteger(mapping.fd) || mapping.fd < 3 || mapping.fd > 255) {
      throw new UsePlanInvalid('Dedicated file descriptors must be integers from 3 through 255.');
    }
    if (descriptors.has(mapping.fd)) throw new UsePlanInvalid(`File descriptor ${mapping.fd} is mapped more than once.`);
    descriptors.add(mapping.fd);
  }
  if (options.ttlMs !== undefined && (!Number.isInteger(options.ttlMs) || options.ttlMs < 1_000 || options.ttlMs > 2_147_483_647)) {
    throw new UsePlanInvalid('--ttl must be between one second and 2147483647 milliseconds.');
  }
}

async function executeWithSecrets(
  options: UsePlanOptions,
  values: Map<string, string>,
  signal: AbortSignal,
): Promise<ProcessLifecycle> {
  assertActive(signal);
  const highestFd = Math.max(2, ...options.fds.map(({ fd }) => fd));
  const stdio: StdioOptions = Array.from({ length: highestFd + 1 }, () => 'ignore');
  stdio[0] = options.stdin === undefined ? 'ignore' : 'pipe';
  // A generic child can echo the credential it receives. Keeping its streams away from the caller
  // remains the default provider-agnostic guarantee; inheriting output is an explicit caller choice
  // for deployment logs and does not make those logs safe for secrets.
  stdio[1] = options.output === 'inherit' ? 'inherit' : 'ignore';
  stdio[2] = options.output === 'inherit' ? 'inherit' : 'ignore';
  for (const { fd } of options.fds) stdio[fd] = 'pipe';
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
  for (const { name, selector } of options.envs) childEnvironment[name] = requiredValue(values, selector);

  let privateDirectory: string | undefined;
  const socketDeliveries: SocketDelivery[] = [];
  if (options.tempFiles.length > 0 || options.sockets.length > 0) {
    privateDirectory = await mkdtemp(join(tmpdir(), 'inheriti-elements-use-'));
    try {
      if (process.platform !== 'win32') await chmod(privateDirectory, 0o700);
      assertActive(signal);
      for (const [index, { name, selector }] of options.tempFiles.entries()) {
        const path = join(privateDirectory, `secret-${index}`);
        const bytes = Buffer.from(requiredValue(values, selector), 'utf8');
        try {
          await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
        } finally {
          bytes.fill(0);
        }
        childEnvironment[name] = path;
      }
      for (const [index, { name, selector }] of options.sockets.entries()) {
        assertActive(signal);
        const endpoint = join(privateDirectory, `secret-${index}.sock`);
        const delivery = await openSecretSocket(endpoint, requiredValue(values, selector));
        socketDeliveries.push(delivery);
        childEnvironment[name] = endpoint;
      }
    } catch (cause) {
      await Promise.all(socketDeliveries.map((delivery) => delivery.cancel()));
      await rm(privateDirectory, { recursive: true, force: true });
      throw Object.assign(new Error('secret_delivery_failed', { cause }), { code: 'secret_delivery_failed' });
    }
  }

  let child: ChildProcess;
  try {
    assertActive(signal);
    child = spawn(options.command[0]!, options.command.slice(1), {
      shell: false,
      stdio,
      env: childEnvironment,
    });
  } catch (cause) {
    for (const name of Object.keys(childEnvironment)) delete childEnvironment[name];
    await Promise.all(socketDeliveries.map((delivery) => delivery.cancel()));
    if (privateDirectory !== undefined) await rm(privateDirectory, { recursive: true, force: true });
    throw Object.assign(new Error('child_process_start_failed', { cause }), { code: 'child_process_start_failed' });
  }
  for (const name of Object.keys(childEnvironment)) delete childEnvironment[name];
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null || killTimer !== undefined) return;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), 250);
  };
  signal.addEventListener('abort', stop, { once: true });
  const exited = childExit(child);
  void exited.catch(() => undefined);
  const writes: Promise<void>[] = [];
  const close = async () => {
    stop();
    await Promise.all(socketDeliveries.map((delivery) => delivery.cancel()));
    await exited.catch(() => undefined);
    for (const stream of child.stdio) { if (stream && 'destroy' in stream) stream.destroy(); }
    await Promise.allSettled(writes);
    if (killTimer !== undefined) clearTimeout(killTimer);
    signal.removeEventListener('abort', stop);
    if (privateDirectory !== undefined) await rm(privateDirectory, { recursive: true, force: true });
  };
  if (signal.aborted) stop();
  try {

    if (options.stdin !== undefined) writes.push(writeSecret(child.stdio[0] as Writable, requiredValue(values, options.stdin)));
    for (const { fd, selector } of options.fds) {
      writes.push(writeSecret(child.stdio[fd] as Writable, requiredValue(values, selector)));
    }
    values.clear();
    const delivery = Promise.all([...writes, ...socketDeliveries.map((one) => one.delivered)]);
    let delivered = false;
    const completed = delivery.then(() => { delivered = true; });
    await Promise.race([
      completed,
      exited.then(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assertActive(signal);
        if (!delivered) throw Object.assign(new Error('secret_delivery_incomplete'), { code: 'secret_delivery_incomplete' });
      }),
    ]);
    assertActive(signal);
    return {
      wait: async () => {
        const code = await exited.catch((error) => { assertActive(signal); throw error; });
        assertActive(signal);
        if (code !== 0) throw Object.assign(new Error('child_command_failed'), { code: 'child_command_failed', exitCode: code });
      },
      close,
    };
  } catch (error) {
    await close();
    assertActive(signal);
    throw error;
  }
}

interface SocketDelivery {
  delivered: Promise<void>;
  cancel(): Promise<void>;
}

async function openSecretSocket(endpoint: string, value: string): Promise<SocketDelivery> {
  const bytes = Buffer.from(value, 'utf8');
  let settled = false;
  let accepted = false;
  const peers = new Set<Socket>();
  let resolveDelivery: () => void = () => undefined;
  let rejectDelivery: (error: Error) => void = () => undefined;
  const delivered = new Promise<void>((resolve, reject) => { resolveDelivery = resolve; rejectDelivery = reject; });
  void delivered.catch(() => undefined);
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    bytes.fill(0);
    if (server.listening) server.close();
    if (error) { for (const peer of peers) peer.destroy(); rejectDelivery(error); return; }
    resolveDelivery();
  };
  const failed = (cause?: unknown) => Object.assign(new Error('secret_delivery_failed', { cause }), { code: 'secret_delivery_failed' });
  const server = createServer((socket) => {
    if (accepted || settled) { socket.destroy(); return; }
    accepted = true;
    peers.add(socket);
    socket.on('error', (cause) => finish(failed(cause)));
    socket.on('close', () => { peers.delete(socket); if (!settled) finish(failed()); });
    socket.end(bytes, () => finish());
  });
  const closed = new Promise<void>((resolve) => server.once('close', resolve));
  server.on('error', (cause) => finish(failed(cause)));
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
  } catch (error) { finish(failed(error)); throw error; }
  return {
    delivered,
    cancel: async () => {
      finish(Object.assign(new Error('secret_delivery_incomplete'), { code: 'secret_delivery_incomplete' }));
      for (const peer of peers) peer.destroy();
      if (server.listening) server.close();
      await closed;
    },
  };
}

function requiredValue(values: ReadonlyMap<string, string>, selector: string): string {
  const value = values.get(selector);
  if (value === undefined) throw Object.assign(new Error('consumed_field_missing'), { code: 'consumed_field_missing' });
  return value;
}

function writeSecret(stream: Writable, value: string): Promise<void> {
  const bytes = Buffer.from(value, 'utf8');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      bytes.fill(0);
      if (cause) { reject(Object.assign(new Error('secret_delivery_failed', { cause }), { code: 'secret_delivery_failed' })); return; }
      resolve();
    };
    stream.once('error', finish);
    stream.once('close', () => { if (!settled) finish(new Error('delivery_stream_closed')); });
    try { stream.end(bytes, (error?: Error | null) => finish(error)); }
    catch (error) { finish(error); }
  });
}

function childExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', (cause) => reject(Object.assign(new Error('child_process_start_failed', { cause }), { code: 'child_process_start_failed' })));
    child.once('exit', (code, signal) => {
      if (signal) reject(Object.assign(new Error('child_command_signaled'), { code: 'child_command_signaled', signal }));
      else resolve(code ?? 1);
    });
  });
}

function deadlineSignal(parent: AbortSignal | undefined, ttlMs: number | undefined): {
  signal: AbortSignal; expired(): 'use_ttl_expired' | 'reveal_expired' | undefined; session(expiresAt: string | Date): void; close(): void;
} {
  const controller = new AbortController();
  let timedOut: 'use_ttl_expired' | 'reveal_expired' | undefined;
  const abortFromParent = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abortFromParent, { once: true });
  if (parent?.aborted) abortFromParent();
  const timer = ttlMs === undefined ? undefined : setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = 'use_ttl_expired';
    controller.abort(new DOMException('Use lifetime expired', 'TimeoutError'));
  }, ttlMs);
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    signal: controller.signal,
    session: (expiresAt) => {
      if (sessionTimer !== undefined) clearTimeout(sessionTimer);
      if (controller.signal.aborted) return;
      const remaining = new Date(expiresAt).getTime() - Date.now();
      const expire = () => { if (controller.signal.aborted) return; timedOut = 'reveal_expired'; controller.abort(new DOMException('Use authorization expired', 'TimeoutError')); };
      if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return; }
      sessionTimer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
    },
    expired: () => timedOut,
    close: () => {
      if (timer !== undefined) clearTimeout(timer);
      if (sessionTimer !== undefined) clearTimeout(sessionTimer);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

interface ProcessLifecycle { wait(): Promise<void>; close(): Promise<void>; }

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw Object.assign(new Error('use_canceled'), { name: 'AbortError', code: 'use_canceled' });
}
