import { afterEach, expect, it, vi } from 'vitest';
import type { Terminal } from '../src/output.js';
import { createGithubSetupPresenter } from '../src/render/github-setup.js';

function fixture(interactive = true) {
  const region = { update: vi.fn(), close: vi.fn() };
  const terminal: Terminal = { write: vi.fn(), writeError: vi.fn(), columns: 100,
    interactive, stdoutIsTTY: interactive, createLiveRegion: vi.fn(() => region) };
  return { terminal, region };
}
afterEach(() => { vi.useRealTimers(); });

it('keeps showing activity and elapsed time while a GitHub request is pending', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { terminal, region } = fixture();
  const presenter = createGithubSetupPresenter(terminal, 'team/app')!;
  try {
    presenter.progress('Pairing job running…');
    presenter.run(42);
    const first = region.update.mock.lastCall?.[0];
    vi.advanceTimersByTime(150);
    expect(region.update.mock.lastCall?.[0]).not.toBe(first);
    vi.advanceTimersByTime(2000);
    const frame = region.update.mock.lastCall?.[0];
    expect(frame).toContain('Pairing job running…');
    expect(frame).toMatch(/2s|00:02/);
    expect(frame).toContain('https://github.com/team/app/actions/runs/42');
    expect(terminal.write).not.toHaveBeenCalled();
  } finally { presenter.close(); }
  expect(region.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not animate or allocate a live region for redirected output', () => {
  vi.useFakeTimers();
  const { terminal } = fixture(false);
  expect(createGithubSetupPresenter(terminal, 'team/app')).toBeUndefined();
  expect(terminal.createLiveRegion).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
