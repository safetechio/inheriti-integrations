import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runYarn } from '../scripts/environment.mjs';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('runYarn', () => {
  it('runs the package manager script directly on Windows, keeping dev arguments intact', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.stubEnv('npm_execpath', 'C:\\node\\yarn.js');
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(child as never);
    const args = [
      'concurrently',
      '-k',
      'vite --mode dev',
      'wait-on http://127.0.0.1:5173 && electron .',
    ];

    const result = runYarn(args);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['C:\\node\\yarn.js', ...args],
      expect.objectContaining({ shell: false }),
    );
    child.emit('exit', 0, null);
    await expect(result).resolves.toBeUndefined();
  });

  it('quotes dev arguments for standalone Windows invocation', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.stubEnv('npm_execpath', '');
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(child as never);

    const result = runYarn(['vite --mode dev', 'wait-on http://127.0.0.1:5173 && electron .']);
    expect(spawn).toHaveBeenCalledWith(
      'yarn.cmd',
      ['"vite --mode dev"', '"wait-on http://127.0.0.1:5173 && electron ."'],
      expect.objectContaining({ shell: true }),
    );
    child.emit('exit', 0, null);
    await result;
  });

  it('uses the shell-free Unix command and propagates failure', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(child as never);

    const result = runYarn(['vite', 'build']);
    expect(spawn).toHaveBeenCalledWith(
      'yarn',
      ['vite', 'build'],
      expect.objectContaining({ shell: false }),
    );
    child.emit('exit', 1, null);
    await expect(result).rejects.toThrow('yarn vite build failed (1)');
  });

  it('propagates spawn errors', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.stubEnv('npm_execpath', 'C:\\node\\yarn.js');
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(child as never);

    const result = runYarn(['vite', 'build']);
    child.emit('error', new Error('spawn EINVAL'));
    await expect(result).rejects.toThrow('spawn EINVAL');
  });
});
