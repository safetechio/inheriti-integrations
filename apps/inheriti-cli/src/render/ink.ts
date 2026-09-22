import { EventEmitter } from 'node:events';
import type { ReactElement } from 'react';
import { render } from 'ink';
import type { Terminal } from '../output.js';

/**
 * Renders one Ink frame and returns it, rather than letting Ink own the terminal.
 *
 * These commands print once and exit; a live-updating root would take over stdout, redraw on resize
 * and swallow the output of a piped run. Rendering into a stream of our own keeps every command's
 * output an ordinary string that `Terminal` writes — which is also what makes it testable.
 */
export function renderFrame(element: ReactElement, columns: number): string {
  const captured: string[] = [];
  const stream = new EventEmitter() as EventEmitter & { columns: number; rows: number; write: (chunk: string) => void };
  stream.columns = columns;
  stream.rows = 0;
  stream.write = (chunk: string) => { captured.push(chunk); };

  const instance = render(element, {
    stdout: stream as unknown as NodeJS.WriteStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  instance.unmount();
  instance.cleanup();
  return (captured.at(-1) ?? '').replace(/\n+$/u, '');
}

export function renderTo(terminal: Terminal, element: ReactElement): void {
  terminal.write(renderFrame(element, terminal.columns));
}
