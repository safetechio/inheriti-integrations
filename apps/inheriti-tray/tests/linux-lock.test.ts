import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));

import { watchLinuxLock } from '../src/modules/launcher/main/linux-lock.js';

it('locks for GNOME and freedesktop active signals, including split chunks', () => {
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  stdout.setEncoding = vi.fn();
  const child = new EventEmitter() as EventEmitter & { stdout: typeof stdout; kill: () => void };
  child.stdout = stdout;
  child.kill = vi.fn();
  mock.spawn.mockReturnValue(child);
  const onLock = vi.fn();
  const stop = watchLinuxLock(onLock);
  expect(mock.spawn).toHaveBeenCalledWith('dbus-monitor', expect.arrayContaining(['--session']), expect.any(Object));
  stdout.emit('data', 'signal path=/ScreenSaver; interface=org.gnome.ScreenSaver; member=ActiveChanged\n   boolean fal');
  stdout.emit('data', 'se\nsignal path=/ScreenSaver; interface=org.freedesktop.ScreenSaver; member=ActiveChanged\n   boolean tr');
  stdout.emit('data', 'ue\n');
  expect(onLock).toHaveBeenCalledTimes(1);
  stop();
  expect(child.kill).toHaveBeenCalledTimes(1);
});
