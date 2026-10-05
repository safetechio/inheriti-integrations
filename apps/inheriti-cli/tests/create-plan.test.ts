import { expect, it, vi } from 'vitest';
import { createPlan } from '../src/commands/create-plan.js';

it('refuses creation without a selected Business Organisation before loading a model', async () => {
  const terminal = { interactive: true, stdoutIsTTY: true, columns: 80, write: vi.fn(), writeError: vi.fn() };
  const context = { core: { getAccessToken: vi.fn() } };
  expect(await createPlan(context as never, undefined, terminal, new AbortController().signal)).toBe(1);
  expect(terminal.writeError).toHaveBeenCalledWith('Select a Business Organisation before creating a plan.');
  expect(context.core.getAccessToken).not.toHaveBeenCalled();
});
