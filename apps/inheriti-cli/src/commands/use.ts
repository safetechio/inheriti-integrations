import { spawn } from 'node:child_process';
import type { ChildProcess, StdioOptions } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
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
  const plan = await loadRevealPlan(context, planId);
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

  const deadline = deadlineSignal(options.signal, options.ttlMs);
  try {
    await consumePlanFields(context, terminal, planId, plan, fields, deadline.signal, async (consumed) => {
      const values = new Map(consumed.map(({ selector, value }) => [selector, renderRequestedValue(value)]));
      await executeWithSecrets(options, values, deadline.signal);
    });
  } catch (error) {
    if (deadline.expired()) {
      throw Object.assign(new Error('use_ttl_expired', { cause: error }), { code: 'use_ttl_expired' });
    }
    throw error;
  } finally {
    deadline.close();
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
  const descriptors = new Set<number>();
  for (const mapping of options.fds) {
    if (!Number.isInteger(mapping.fd) || mapping.fd < 3 || mapping.fd > 255) {
      throw new UsePlanInvalid('Dedicated file descriptors must be integers from 3 through 255.');
    }
    if (descriptors.has(mapping.fd)) throw new UsePlanInvalid(`File descriptor ${mapping.fd} is mapped more than once.`);
    descriptors.add(mapping.fd);
  }
  if (options.ttlMs !== undefined && (!Number.isInteger(options.ttlMs) || options.ttlMs < 1_000)) {
    throw new UsePlanInvalid('--ttl must be at least one second.');
  }
}

async function executeWithSecrets(
  options: UsePlanOptions,
  values: ReadonlyMap<string, string>,
  signal: AbortSignal,
): Promise<void> {
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
        const endpoint = join(privateDirectory, `secret-${index}.sock`);
        const delivery = await openSecretSocket(endpoint, requiredValue(values, selector));
        socketDeliveries.push(delivery);
        childEnvironment[name] = endpoint;
      }
    } catch (cause) {
      for (const delivery of socketDeliveries) delivery.cancel();
      await rm(privateDirectory, { recursive: true, force: true });
      throw Object.assign(new Error('secret_delivery_failed', { cause }), { code: 'secret_delivery_failed' });
    }
  }

  let child: ChildProcess;
  try {
    child = spawn(options.command[0]!, options.command.slice(1), {
      shell: false,
      stdio,
      env: childEnvironment,
    });
  } catch (cause) {
    for (const delivery of socketDeliveries) delivery.cancel();
    if (privateDirectory !== undefined) await rm(privateDirectory, { recursive: true, force: true });
    throw Object.assign(new Error('child_process_start_failed', { cause }), { code: 'child_process_start_failed' });
  }
  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
  signal.addEventListener('abort', stop, { once: true });
  const exited = childExit(child);
  try {
    const writes: Promise<void>[] = [];
    if (options.stdin !== undefined) writes.push(writeSecret(child.stdio[0] as Writable, requiredValue(values, options.stdin)));
    for (const { fd, selector } of options.fds) {
      writes.push(writeSecret(child.stdio[fd] as Writable, requiredValue(values, selector)));
    }
    const delivery = Promise.all([...writes, ...socketDeliveries.map((one) => one.delivered)]);
    const first = await Promise.race([
      delivery.then(() => 'delivered' as const),
      exited.then(() => 'exited' as const),
    ]);
    if (first === 'exited') {
      throw Object.assign(new Error('secret_delivery_incomplete'), { code: 'secret_delivery_incomplete' });
    }
    const code = await exited;
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (code !== 0) throw Object.assign(new Error('child_command_failed'), { code: 'child_command_failed', exitCode: code });
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    for (const delivery of socketDeliveries) delivery.cancel();
    if (privateDirectory !== undefined) await rm(privateDirectory, { recursive: true, force: true });
  }
}

interface SocketDelivery {
  delivered: Promise<void>;
  cancel(): void;
}

async function openSecretSocket(endpoint: string, value: string): Promise<SocketDelivery> {
  const bytes = Buffer.from(value, 'utf8');
  let settled = false;
  let resolveDelivery: () => void = () => undefined;
  let rejectDelivery: (error: Error) => void = () => undefined;
  const delivered = new Promise<void>((resolve, reject) => {
    resolveDelivery = resolve;
    rejectDelivery = reject;
  });
  // Cancellation can happen after a child exits without connecting; pre-handle that rejection.
  void delivered.catch(() => undefined);
  const server = createServer((socket) => {
    if (settled) {
      socket.destroy();
      return;
    }
    settled = true;
    socket.end(bytes, () => {
      bytes.fill(0);
      if (server.listening) server.close();
      resolveDelivery();
    });
  });
  server.on('error', (cause) => {
    if (settled) return;
    settled = true;
    bytes.fill(0);
    rejectDelivery(Object.assign(new Error('secret_delivery_failed', { cause }), { code: 'secret_delivery_failed' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });
  return {
    delivered,
    cancel: () => {
      if (!settled) {
        settled = true;
        bytes.fill(0);
        rejectDelivery(Object.assign(new Error('secret_delivery_incomplete'), { code: 'secret_delivery_incomplete' }));
      }
      if (server.listening) server.close();
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
    stream.end(bytes, (error?: Error | null) => {
      bytes.fill(0);
      if (error) reject(Object.assign(new Error('secret_delivery_failed', { cause: error }), { code: 'secret_delivery_failed' }));
      else resolve();
    });
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
  signal: AbortSignal; expired(): boolean; close(): void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abortFromParent, { once: true });
  if (parent?.aborted) abortFromParent();
  const timer = ttlMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Use lifetime expired', 'TimeoutError'));
  }, ttlMs);
  return {
    signal: controller.signal,
    expired: () => timedOut,
    close: () => {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}
