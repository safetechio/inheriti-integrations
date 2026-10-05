import { afterEach, expect, it, vi } from 'vitest';
import { createLocalAssistantInstallPresenter } from '../src/render/local-assistant-install.js';

afterEach(() => vi.useRealTimers());

it('shows live download progress and completion in the terminal', async () => {
  vi.useFakeTimers();
  const frames: string[] = [];
  const close = vi.fn();
  const presenter = createLocalAssistantInstallPresenter({
    interactive: true, stdoutIsTTY: true, columns: 80,
    write: vi.fn(), writeError: vi.fn(),
    createLiveRegion: () => ({ update: frame => frames.push(frame), close }),
  });
  presenter?.progress({ phase: 'model', downloadedBytes: 50_000_000, totalBytes: 100_000_000 });
  await vi.advanceTimersByTimeAsync(180);
  expect(frames.at(-1)).toContain('Downloading model · 50%');
  presenter?.complete();
  expect(frames.at(-1)).toContain('Local assistant ready');
  presenter?.close();
  expect(close).toHaveBeenCalledOnce();
});
