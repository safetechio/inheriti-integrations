import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '../src/output.js';
import { usePlan } from '../src/commands/use.js';

function terminal(): Terminal & { lines: string[] } {
  const lines: string[] = [];
  return { lines, stdoutIsTTY: false, interactive: false, columns: 200, write: (line) => lines.push(line), writeError: vi.fn() };
}

function context(value = 'fixture-secret-never-print'): { core: Record<string, unknown> } {
  return { core: {
    getAccessToken: async () => 'token',
    getPlan: async () => ({
      assets: [{ id: 'asset-1', code: 'service', fieldNames: ['token'] }],
      revealPolicy: { custodian: 'FORCE' },
    }),
    withReveal: vi.fn(async (_planId, _options, work) => work({
      consumeFields: async (
        fields: ReadonlyArray<{ selector: string }>,
        destination: (values: ReadonlyArray<{ selector: string; value: string }>) => unknown,
      ) => destination(
        fields.map(({ selector }) => ({ selector, value })),
      ),
    })),
  } };
}

describe('plans use', () => {
  it('authorizes every mapping with its actual non-visual destination', async () => {
    const input = context();
    await usePlan(input as never, terminal(), 'plan-1', {
      stdin: 'service.token',
      envs: [{ name: 'INHERITI_USE_TEST_VALUE', selector: 'service.token' }],
      tempFiles: [], sockets: [], fds: [],
      command: [process.execPath, '-e', "process.stdin.resume();process.stdin.on('end',()=>process.exit(process.env.INHERITI_USE_TEST_VALUE?0:9))"],
    });

    const work = (input.core.withReveal as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    const consumeFields = vi.fn();
    await work({ consumeFields });
    expect(consumeFields).toHaveBeenCalledWith([
      { selector: 'service.token', options: { action: 'USE_FIELD', destination: 'STDIN' } },
      { selector: 'service.token', options: { action: 'USE_FIELD', destination: 'ENVIRONMENT' } },
    ], expect.any(Function));
  });

  it('delivers one field through child stdin without printing it', async () => {
    const output = terminal();
    await usePlan(context() as never, output, 'plan-1', {
      stdin: 'service.token',
      envs: [], tempFiles: [], sockets: [],
      fds: [],
      command: [process.execPath, '-e',
        "let size=0;process.stdin.on('data',chunk=>size+=chunk.length);process.stdin.on('end',()=>process.exit(size>0?0:9))"],
    });

    expect(output.lines).toEqual([
      'Opening the plan.',
      'Command completed. Secret values were not printed by Inheriti.',
    ]);
    expect(output.lines.join('\n')).not.toContain('fixture-secret-never-print');
  });

  it('suppresses child stdout and stderr even when it echoes the secret', async () => {
    const output = terminal();
    await usePlan(context() as never, output, 'plan-1', {
      stdin: 'service.token', envs: [], tempFiles: [], sockets: [], fds: [],
      command: [process.execPath, '-e',
        "let v='';process.stdin.on('data',c=>v+=c);process.stdin.on('end',()=>{console.log(v);console.error(v)})"],
    });
    expect(output.lines.join('\n')).not.toContain('fixture-secret-never-print');
  });

  it('delivers independently through a dedicated descriptor', async () => {
    const output = terminal();
    await usePlan(context() as never, output, 'plan-1', {
      envs: [], tempFiles: [], sockets: [], fds: [{ fd: 3, selector: 'service.token' }],
      command: [process.execPath, '-e',
        "const fs=require('fs');const value=fs.readFileSync(3);process.exit(value.length>0?0:9)"],
    });

    expect(output.lines.join('\n')).not.toContain('fixture-secret-never-print');
  });

  it('rejects unknown selectors before opening a reveal', async () => {
    const input = context();
    await expect(usePlan(input as never, terminal(), 'plan-1', {
      stdin: 'service.missing', envs: [], tempFiles: [], sockets: [], fds: [], command: [process.execPath, '-e', 'process.exit(0)'],
    })).rejects.toThrow('Unknown plan field: service.missing');
    expect(input.core.withReveal).not.toHaveBeenCalled();
  });

  it('propagates a child failure as a stable secret-free error', async () => {
    await expect(usePlan(context() as never, terminal(), 'plan-1', {
      stdin: 'service.token', envs: [], tempFiles: [], sockets: [], fds: [], command: [process.execPath, '-e', 'process.exit(7)'],
    })).rejects.toMatchObject({ code: 'child_command_failed', exitCode: 7 });
  });

  it('injects a mapping only into the child environment', async () => {
    const output = terminal();
    const original = process.env.INHERITI_USE_TEST_VALUE;
    await usePlan(context() as never, output, 'plan-1', {
      envs: [{ name: 'INHERITI_USE_TEST_VALUE', selector: 'service.token' }], tempFiles: [], sockets: [], fds: [],
      command: [process.execPath, '-e', "process.exit(process.env.INHERITI_USE_TEST_VALUE?.length?0:9)"],
    });
    expect(process.env.INHERITI_USE_TEST_VALUE).toBe(original);
    expect(output.lines.join('\n')).not.toContain('fixture-secret-never-print');
  });

  it('uses a restricted temporary file and removes it after the child exits', async () => {
    const output = terminal();
    await usePlan(context() as never, output, 'plan-1', {
      envs: [], tempFiles: [{ name: 'INHERITI_USE_TEST_PATH', selector: 'service.token' }], sockets: [], fds: [],
      command: [process.execPath, '-e',
        "const fs=require('fs');const p=process.env.INHERITI_USE_TEST_PATH;const s=fs.statSync(p);process.exit((s.mode&0o777)===0o600&&fs.readFileSync(p).length?0:9)"],
    });
    expect(output.lines.join('\n')).not.toContain('fixture-secret-never-print');
  });

  it('serves a field once through an ephemeral local socket', async () => {
    const output = terminal();
    await usePlan(context() as never, output, 'plan-1', {
      envs: [], tempFiles: [], sockets: [{ name: 'INHERITI_USE_TEST_SOCKET', selector: 'service.token' }], fds: [],
      command: [process.execPath, '-e',
        "const net=require('net');let size=0;const s=net.createConnection(process.env.INHERITI_USE_TEST_SOCKET);s.on('data',c=>size+=c.length);s.on('end',()=>process.exit(size?0:9));s.on('error',()=>process.exit(8))"],
    });
    expect(output.lines.join('\n')).not.toContain('fixture-secret-never-print');
  });
});

const envOptions = {
  envs: [{ name: 'INHERITI_USE_TEST_VALUE', selector: 'service.token' }],
  tempFiles: [], sockets: [], fds: [],
  command: [process.execPath, '-e', 'setInterval(()=>{},1000)'],
};

describe('process delivery lifecycle', () => {
  it('rejects pre-aborted work before loading the plan', async () => {
    const input = context();
    const controller = new AbortController();
    controller.abort();
    await expect(usePlan(input as never, terminal(), 'plan-1', { ...envOptions, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(input.core.withReveal).not.toHaveBeenCalled();
  });

  it('rejects unsupported timer durations', async () => {
    await expect(usePlan(context() as never, terminal(), 'plan-1', { ...envOptions, ttlMs: 2147483648 })).rejects.toMatchObject({ code: 'use_plan_invalid' });
  });

  it('finishes the reveal before waiting for a long-running child', async () => {
    const input = context();
    let finalized = false;
    input.core.withReveal = vi.fn(async (_id, _options, work) => {
      await work({ consumeFields: async (fields: ReadonlyArray<{ selector: string }>, destination: (values: ReadonlyArray<{ selector: string; value: string }>) => unknown) => destination(fields.map(({ selector }) => ({ selector, value: 'fixture' }))) });
      finalized = true;
    });
    const running = usePlan(input as never, terminal(), 'plan-1', { ...envOptions, command: [process.execPath, '-e', 'setTimeout(()=>{},150)'] });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(finalized).toBe(true);
    await running;
  });

  it('terminates a child that ignores TERM on cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-ready-test-'));
    const marker = join(directory, 'ready');
    const controller = new AbortController();
    const running = usePlan(context() as never, terminal(), 'plan-1', {
      ...envOptions, signal: controller.signal,
      command: [process.execPath, '-e', "process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)", marker],
    });
    void running.catch(() => undefined);
    try {
      await waitForMarker(marker);
      controller.abort();
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    } finally { controller.abort(); await running.catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
  });

  it('terminates a delivered child if reveal finalization fails', async () => {
    const input = context();
    input.core.withReveal = vi.fn(async (_id, _options, work) => {
      await work({ consumeFields: async (fields: ReadonlyArray<{ selector: string }>, destination: (values: ReadonlyArray<{ selector: string; value: string }>) => unknown) => destination(fields.map(({ selector }) => ({ selector, value: 'fixture' }))) });
      throw new Error('finalization failed');
    });
    await expect(usePlan(input as never, terminal(), 'plan-1', envOptions)).rejects.toThrow('finalization failed');
  });

  it('rejects expired reveal authorization before spawning', async () => {
    const input = context();
    input.core.withReveal = vi.fn(async (_id, _options, work) => work({
      session: { expiresAt: new Date(Date.now() - 1).toISOString() },
      consumeFields: async (fields: ReadonlyArray<{ selector: string }>, destination: (values: ReadonlyArray<{ selector: string; value: string }>) => unknown) => destination(fields.map(({ selector }) => ({ selector, value: 'fixture' }))),
    }));
    await expect(usePlan(input as never, terminal(), 'plan-1', envOptions)).rejects.toMatchObject({ code: 'reveal_expired' });
  });

  it('keeps a spawn failure stable', async () => {
    await expect(usePlan(context() as never, terminal(), 'plan-1', { ...envOptions, command: ['/inheriti-missing-executable'] })).rejects.toMatchObject({ code: 'child_process_start_failed' });
  });

  it('rejects a child that never connects to its socket', async () => {
    await expect(usePlan(context() as never, terminal(), 'plan-1', {
      envs: [], tempFiles: [], fds: [], sockets: [{ name: 'SOCKET', selector: 'service.token' }],
      command: [process.execPath, '-e', 'process.exit(0)'],
    })).rejects.toMatchObject({ code: 'secret_delivery_incomplete' });
  });
});


describe('OS delivery regressions', () => {
  it('captures no echoed secrets on actual stdout or stderr', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-output-test-'));
    try {
      const executable = join(directory, 'use.mjs');
      await build({
        stdin: { contents: `import { usePlan } from './src/commands/use.ts';
          await usePlan({}, { write(){}, writeError(){} }, 'fixture', {
            stdin:'service.token',envs:[],tempFiles:[],sockets:[],fds:[],
            command:[process.execPath,'-e',"let v='';process.stdin.on('data',c=>v+=c);process.stdin.on('end',()=>{console.log(v);console.error(v)})"]
          });`, resolveDir: process.cwd() },
        bundle: true, platform: 'node', format: 'esm', outfile: executable,
        plugins: [{ name: 'fixture-reveal', setup(builder) {
          builder.onResolve({ filter: /reveal\.js$/ }, () => ({ path: 'fixture-reveal', namespace: 'fixture' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
            export const loadRevealPlan=async()=>({assets:[{id:'fixture',code:'service',fieldNames:['token']}]});
            export const renderRequestedValue=String;
            export const consumePlanFields=async(_c,_t,_id,_p,fields,_s,destination)=>destination(fields.map(({selector})=>({selector,value:'fixture-secret-never-print'})));
          ` }));
        } }],
      });
      const captured = await promisify(execFile)(process.execPath, [executable]);
      expect(captured.stdout).toBe('');
      expect(captured.stderr).toBe('');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each([0, 7])('removes private files after child exit %s', async (exitCode) => {
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-path-test-'));
    const metadata = join(directory, 'metadata');
    try {
      const running = usePlan(context() as never, terminal(), 'plan-1', {
        envs: [], tempFiles: [{ name: 'SECRET_PATH', selector: 'service.token' }], sockets: [], fds: [],
        command: [process.execPath, '-e', `const fs=require('fs');const p=process.env.SECRET_PATH;fs.writeFileSync(process.argv[1],p);process.exit((fs.statSync(require('path').dirname(p)).mode&0o777)===0o700?${exitCode}:9)`, metadata],
      });
      if (exitCode === 0) await running;
      if (exitCode !== 0) await expect(running).rejects.toMatchObject({ code: 'child_command_failed', exitCode });
      const path = await readFile(metadata, 'utf8');
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(path, '..'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not deliver a socket value to a second connection', async () => {
    await usePlan(context() as never, terminal(), 'plan-1', {
      envs: [], tempFiles: [], sockets: [{ name: 'SECRET_SOCKET', selector: 'service.token' }], fds: [],
      command: [process.execPath, '-e', `const net=require('net');const p=process.env.SECRET_SOCKET;let count=0;const first=net.createConnection(p);first.on('data',b=>count+=b.length);first.on('end',()=>{if(!count)process.exit(9);const second=net.createConnection(p);second.on('data',()=>process.exit(8));second.on('error',()=>process.exit(0));second.on('close',()=>process.exit(0));});`],
    });
  });

  it('cancels a connected socket whose peer never reads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-ready-test-'));
    const marker = join(directory, 'ready');
    const controller = new AbortController();
    const running = usePlan(context('x'.repeat(8 * 1024 * 1024)) as never, terminal(), 'plan-1', {
      envs: [], tempFiles: [], sockets: [{ name: 'SECRET_SOCKET', selector: 'service.token' }], fds: [],
      signal: controller.signal,
      command: [process.execPath, '-e', `const net=require('net');const socket=net.createConnection(process.env.SECRET_SOCKET);socket.on('connect',()=>{socket.pause();require('fs').writeFileSync(process.argv[1],'ready')});setInterval(()=>{},1000)`, marker],
    });
    void running.catch(() => undefined);
    try {
      await waitForMarker(marker);
      controller.abort();
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    } finally { controller.abort(); await running.catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
  });

  it('fails delivery when the accepted socket resets', async () => {
    await expect(usePlan(context('x'.repeat(8 * 1024 * 1024)) as never, terminal(), 'plan-1', {
      envs: [], tempFiles: [], sockets: [{ name: 'SECRET_SOCKET', selector: 'service.token' }], fds: [],
      command: [process.execPath, '-e', `const net=require('net');const socket=net.createConnection(process.env.SECRET_SOCKET);socket.on('connect',()=>socket.destroy());setInterval(()=>{},1000)`],
    })).rejects.toMatchObject({ code: 'secret_delivery_failed' });
  });

  it('fails a pipe write without an unhandled EPIPE', async () => {
    await expect(usePlan(context('x'.repeat(8 * 1024 * 1024)) as never, terminal(), 'plan-1', {
      stdin: 'service.token', envs: [], tempFiles: [], sockets: [], fds: [],
      command: [process.execPath, '-e', 'process.stdin.destroy();process.exit(0)'],
    })).rejects.toMatchObject({ code: 'secret_delivery_failed' });
  });

  it('accepts short-lived children after delivery', async () => {
    for (let index = 0; index < 5; index += 1) {
      await usePlan(context() as never, terminal(), 'plan-1', {
        stdin: 'service.token', envs: [], tempFiles: [], sockets: [], fds: [],
        command: [process.execPath, '-e', `process.stdin.resume();process.stdin.on('end',()=>process.exit(0))`],
      });
    }
  });
});


describe('delivery deadlines', () => {
  it('bounds the whole command with the explicit TTL', async () => {
    await expect(usePlan(context() as never, terminal(), 'plan-1', { ...envOptions, ttlMs: 1000 })).rejects.toMatchObject({ code: 'use_ttl_expired' });
  });

  it('terminates a delivered child when authorization expires', async () => {
    const input = context();
    input.core.withReveal = vi.fn(async (_id, _options, work) => work({
      session: { expiresAt: new Date(Date.now() + 100).toISOString() },
      consumeFields: async (fields: ReadonlyArray<{ selector: string }>, destination: (values: ReadonlyArray<{ selector: string; value: string }>) => unknown) => destination(fields.map(({ selector }) => ({ selector, value: 'fixture' }))),
    }));
    await expect(usePlan(input as never, terminal(), 'plan-1', envOptions)).rejects.toMatchObject({ code: 'reveal_expired' });
  });

  it('does not spawn if cancellation arrives while loading the plan', async () => {
    const input = context();
    const controller = new AbortController();
    input.core.getPlan = async () => {
      controller.abort();
      return { assets: [{ id: 'fixture', code: 'service', fieldNames: ['token'] }] };
    };
    await expect(usePlan(input as never, terminal(), 'plan-1', { ...envOptions, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(input.core.withReveal).not.toHaveBeenCalled();
  });

  it('cancels asynchronous private-resource setup without spawning', async () => {
    const input = context();
    const controller = new AbortController();
    const withReveal = input.core.withReveal as ReturnType<typeof vi.fn>;
    input.core.withReveal = vi.fn(async (id, options, work) => {
      setImmediate(() => controller.abort());
      return withReveal(id, options, work);
    });
    await expect(usePlan(input as never, terminal(), 'plan-1', {
      envs: [], tempFiles: [{ name: 'SECRET_PATH', selector: 'service.token' }], sockets: [], fds: [],
      signal: controller.signal, command: ['/inheriti-missing-executable'],
    })).rejects.toMatchObject({ name: 'AbortError' });
  });
});


it('preserves cancellation when authorization expires during TERM grace', async () => {
  const input = context();
  const controller = new AbortController();
  input.core.withReveal = vi.fn(async (_id, _options, work) => work({
    session: { expiresAt: new Date(Date.now() + 200).toISOString() },
    consumeFields: async (fields: ReadonlyArray<{ selector: string }>, destination: (values: ReadonlyArray<{ selector: string; value: string }>) => unknown) => destination(fields.map(({ selector }) => ({ selector, value: 'fixture' }))),
  }));
  const running = usePlan(input as never, terminal(), 'plan-1', {
    ...envOptions, signal: controller.signal,
    command: [process.execPath, '-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
  });
  setTimeout(() => controller.abort(), 100);
  await expect(running).rejects.toMatchObject({ name: 'AbortError', code: 'use_canceled' });
});


async function waitForMarker(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { await stat(path); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Child did not reach the delivery phase.');
}
