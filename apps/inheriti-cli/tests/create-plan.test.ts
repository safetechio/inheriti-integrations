import { expect, it, vi } from 'vitest';
import { createPlan } from '../src/commands/create-plan.js';
import { messageFor, planCreationFailureMessage } from '../src/commands/errors.js';

it('refuses creation without a selected Business Organisation before loading a model', async () => {
  const terminal = { interactive: true, stdoutIsTTY: true, columns: 80, write: vi.fn(), writeError: vi.fn() };
  const context = { core: { getAccessToken: vi.fn() } };
  expect(await createPlan(context as never, undefined, terminal, new AbortController().signal)).toBe(1);
  expect(terminal.writeError).toHaveBeenCalledWith('Select a Business Organisation before creating a plan.');
  expect(context.core.getAccessToken).not.toHaveBeenCalled();
});

it('reports only safe plan creation causes and the failed phase', () => {
  expect(messageFor(new Error('master_key_not_claimed'))).toBe('Claim the Organisation key in SafeKey Mobile before creating a plan.');
  expect(planCreationFailureMessage('key', new Error('master_key_not_claimed'))).toContain('Claim the Organisation key');
  expect(planCreationFailureMessage('key', new Error('plan_creation_input_changed'))).toBe('The plan details changed during creation. Close the window and start plan creation again.');
  expect(planCreationFailureMessage('save', { status: 402, message: 'private-secret' })).toBe('The Organisation has reached its plan capacity.');
  expect(planCreationFailureMessage('context', new Error('private-secret'))).toBe('Could not prepare the plan. Check your Organisation access and retry.');
  expect(planCreationFailureMessage('save', new Error('private-secret'))).toBe('Could not save the plan. Check your access and plan data before retrying.');
  expect(messageFor(new Error('private-secret'))).toBe('The command failed.');
});
