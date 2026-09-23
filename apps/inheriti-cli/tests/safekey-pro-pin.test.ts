import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { readHiddenPin } from '../src/safekey-pro.js';

it('reads a PIN without echo and restores terminal mode', async () => {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) { this.isRaw = value; },
    resume: vi.fn(),
    pause: vi.fn(),
  });
  const output = vi.fn();
  vi.stubGlobal('process', { stdin: input, stderr: { write: output } });
  try {
    const pending = readHiddenPin();
    input.emit('data', Buffer.from('1234\r'));
    expect(await pending).toEqual(Uint8Array.from([49, 50, 51, 52]));
    expect(output.mock.calls.map(([value]) => value).join('')).toBe('SafeKey PRO PIN: \n');
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('data')).toBe(0);
    expect(input.pause).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
