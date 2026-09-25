import { expect, it, vi } from 'vitest';
import { promptSelect } from '../src/render/select.jsx';

const ink = vi.hoisted(() => {
  let finish = () => {};
  return {
    clear: vi.fn(),
    unmount: vi.fn(() => finish()),
    waitUntilExit: () => new Promise<void>((resolve) => { finish = resolve; }),
  };
});
vi.mock('ink', async (importOriginal) => ({
  ...await importOriginal<typeof import('ink')>(),
  render: () => ink,
}));

it('unmounts the device picker when the reveal is canceled', async () => {
  const controller = new AbortController();
  const selection = promptSelect('Device?', [{ value: 'SK_PRO' }], controller.signal);
  controller.abort();
  await expect(selection).resolves.toBeUndefined();
  expect(ink.clear).toHaveBeenCalledOnce();
  expect(ink.unmount).toHaveBeenCalledOnce();
});
