import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '../src/output.js';
import { usePlan } from '../src/commands/use.js';

function terminal(): Terminal & { lines: string[] } {
  const lines: string[] = [];
  return { lines, interactive: false, columns: 200, write: (line) => lines.push(line), writeError: vi.fn() };
}

function context(value = 'fixture-secret-never-print'): { core: Record<string, unknown> } {
  return { core: {
    getAccessToken: async () => 'token',
    getPlan: async () => ({
      assets: [{ id: 'asset-1', code: 'service', fieldNames: ['token'] }],
      revealPolicy: { custodian: 'BYPASS' },
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
