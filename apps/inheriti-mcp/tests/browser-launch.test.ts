import { spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { openBrowser } from '../src/browser-login.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ once: vi.fn(), unref: vi.fn() })) }));

it('opens the complete OAuth URL with the Windows default browser', () => {
  const url = "https://issuer.test/auth?client_id=inheriti&redirect_uri=http%3A%2F%2F127.0.0.1&state=O'Neil";
  openBrowser(url, 'win32');
  expect(spawn).toHaveBeenCalledWith('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Start-Process -FilePath 'https://issuer.test/auth?client_id=inheriti&redirect_uri=http%3A%2F%2F127.0.0.1&state=O''Neil'",
  ], { stdio: 'ignore' });
  expect(vi.mocked(spawn).mock.results[0]?.value.unref).not.toHaveBeenCalled();
});
