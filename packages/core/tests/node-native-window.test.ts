import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const { spawn, spawnSync } = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn, spawnSync }));
import { createNativeWindowSession } from '../src/node-native-window.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('reuses one native window and passes local pages through its private pipe', () => {
  const stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  const child = Object.assign(new EventEmitter(), { stdin, kill: vi.fn(), unref: vi.fn() });
  spawn.mockReturnValue(child);
  const closed = vi.fn();
  const session = createNativeWindowSession(closed);
  const first = `http://127.0.0.1:3421/${'a'.repeat(48)}`;
  const second = `http://127.0.0.1:3422/${'b'.repeat(48)}`;
  expect(() => session.open('https://example.com/private')).toThrow('local_window_url_invalid');
  session.open(first);
  session.open(second);
  expect(spawn).toHaveBeenCalledOnce();
  expect(spawn.mock.calls[0]?.[1]).toEqual([]);
  expect(stdin.write.mock.calls).toEqual([[`${first}\n`], [`${second}\n`]]);
  session.complete();
  expect(stdin.end).toHaveBeenCalledWith('HOLD\n');
  expect(child.unref).toHaveBeenCalledOnce();
  child.emit('exit', 0);
  expect(closed).not.toHaveBeenCalled();
});

it('cancels the active operation when the native window closes', () => {
  const stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  const child = Object.assign(new EventEmitter(), { stdin, kill: vi.fn(), unref: vi.fn() });
  spawn.mockReturnValue(child);
  const closed = vi.fn();
  const session = createNativeWindowSession(closed);
  session.open(`http://127.0.0.1:3421/${'c'.repeat(48)}`);
  child.emit('exit', 0);
  expect(closed).toHaveBeenCalledOnce();
  expect(() => session.open(`http://127.0.0.1:3421/${'d'.repeat(48)}`)).toThrow('local_window_closed');
});

it('reports a missing native executable as unavailable', () => {
  const stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  const child = Object.assign(new EventEmitter(), { stdin, kill: vi.fn(), unref: vi.fn() });
  spawn.mockReturnValue(child);
  const closed = vi.fn();
  createNativeWindowSession(closed).open(`http://127.0.0.1:3421/${'e'.repeat(48)}`);
  child.emit('error', new Error('private spawn diagnostic'));
  expect(closed).toHaveBeenCalledWith('unavailable');
  expect(JSON.stringify(closed.mock.calls)).not.toContain('private spawn diagnostic');
});

it('restores the desktop session for a headless MCP process on Linux', () => {
  if (process.platform !== 'linux') return;
  vi.stubEnv('DISPLAY', undefined);
  vi.stubEnv('WAYLAND_DISPLAY', undefined);
  vi.stubEnv('XDG_RUNTIME_DIR', undefined);
  vi.stubEnv('DBUS_SESSION_BUS_ADDRESS', undefined);
  spawnSync.mockReturnValue({ status: 0, stdout: 'DISPLAY=:0\nWAYLAND_DISPLAY=wayland-0\nXDG_RUNTIME_DIR=/run/user/1000\nDBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus\nPRIVATE_VALUE=not-for-window\n' });
  const stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  spawn.mockReturnValue(Object.assign(new EventEmitter(), { stdin, kill: vi.fn(), unref: vi.fn() }));
  createNativeWindowSession(vi.fn()).open(`http://127.0.0.1:3421/${'f'.repeat(48)}`);
  expect(spawnSync).toHaveBeenCalledWith('systemctl', ['--user', 'show-environment'], expect.objectContaining({ timeout: 1_500 }));
  const environment = spawn.mock.calls[0]?.[2].env;
  expect(environment).toMatchObject({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' });
  expect(environment.PRIVATE_VALUE).toBeUndefined();
});
