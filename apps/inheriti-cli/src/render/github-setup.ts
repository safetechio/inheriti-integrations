import type { Terminal } from '../output.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function createGithubSetupPresenter(terminal: Terminal, repository: string):
  { progress(message: string): void; run(runId: number): void; close(): void } | undefined {
  if (!terminal.interactive || !terminal.stdoutIsTTY) return undefined;
  const region = terminal.createLiveRegion?.();
  if (!region) return undefined;
  const startedAt = Date.now();
  let message = 'Preparing GitHub setup…';
  let runId: number | undefined;
  let tick = 0;
  let closed = false;
  const draw = () => region.update(`${SPINNER[tick % SPINNER.length]} ${message} (${Math.floor((Date.now() - startedAt) / 1000)}s)` +
    (runId === undefined ? '' : `\nGitHub run: https://github.com/${repository}/actions/runs/${runId}`));
  const timer = setInterval(() => { tick += 1; draw(); }, 120);
  timer.unref();
  draw();
  return {
    progress(value) { message = value; draw(); },
    run(value) { if (Number.isSafeInteger(value) && value > 0) { runId = value; draw(); } },
    close() { if (closed) return; closed = true; clearInterval(timer); region.close(); },
  };
}
