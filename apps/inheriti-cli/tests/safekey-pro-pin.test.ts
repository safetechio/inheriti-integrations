import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { readHiddenPin } from '../src/safekey-pro.js';
import { registerCliCancel } from '../src/cancellation.js';

it('reads a PIN without echo and restores terminal mode', async () => {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) { this.isRaw = value; },
    resume: vi.fn(),
    pause: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
  });
  const output = vi.fn();
  vi.stubGlobal('process', { stdin: input, stderr: { isTTY: true, write: output } });
  try {
    const pending = readHiddenPin();
    input.emit('data', '1234\r');
    expect(await pending).toEqual(Uint8Array.from([49, 50, 51, 52]));
    expect(output.mock.calls.map(([value]) => value).join('')).toBe('\r\x1b[2KSafeKey PRO PIN: ');
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('data')).toBe(0);
    expect(input.pause).toHaveBeenCalledOnce();
    expect(input.ref).toHaveBeenCalledOnce();
    expect(input.unref).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('treats Ctrl+C at the hidden PIN prompt as cancellation of the whole reveal', async () => {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true, isRaw: false,
    setRawMode(value: boolean) { this.isRaw = value; },
    resume: vi.fn(), pause: vi.fn(), ref: vi.fn(), unref: vi.fn(),
  });
  const controller = new AbortController();
  const output = vi.fn();
  vi.stubGlobal('process', Object.assign(new EventEmitter(), { stdin: input, stderr: { isTTY: true, write: output } }));
  const unregister = registerCliCancel(controller);
  try {
    const pending = readHiddenPin(controller.signal);
    input.emit('data', '\x03');
    await expect(pending).rejects.toThrow('SAFEKEY_ABORTED');
    expect(controller.signal.aborted).toBe(true);
    expect(output.mock.calls.at(-1)?.[0]).toBe('\r\x1b[2K');
    expect(input.isRaw).toBe(false);
    expect(input.unref).toHaveBeenCalledOnce();
  } finally {
    unregister();
    vi.unstubAllGlobals();
  }
});
