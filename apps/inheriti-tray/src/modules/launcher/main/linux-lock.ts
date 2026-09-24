import { spawn } from 'node:child_process';

export function watchLinuxLock(onLock: () => void): () => void {
  const monitor = spawn('dbus-monitor', [
    '--session',
    "type='signal',interface='org.freedesktop.ScreenSaver',member='ActiveChanged'",
    "type='signal',interface='org.gnome.ScreenSaver',member='ActiveChanged'",
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buffered = '';
  let activeChanged = false;
  monitor.stdout.setEncoding('utf8');
  monitor.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('signal ')) activeChanged = line.includes('member=ActiveChanged');
      if (activeChanged && line.trim() === 'boolean true') {
        activeChanged = false;
        onLock();
      }
    }
  });
  monitor.on('error', () => console.warn('Linux lock monitoring unavailable'));
  return () => monitor.kill();
}
