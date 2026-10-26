import { expect, it, vi } from 'vitest';

vi.mock('../src/configuration.js', () => ({ CliConfigurationInvalid: class extends Error {} }));
vi.mock('../src/organizations.js', () => ({ OrganizationChoiceRequired: class extends Error {} }));
vi.mock('../src/commands/use.js', () => ({ UsePlanInvalid: class extends Error {} }));

import { messageFor } from '../src/commands/errors.js';

it('maps the exact governance code to safe Business repair guidance', () => {
  const error = Object.assign(new Error('private diagnostic'), {
    details: { error: 'plan_governance_reconfiguration_required', description: 'private diagnostic' },
  });
  const message = messageFor(error, true);
  expect(message).toContain('Update Moderators in Inheriti Business plan settings');
  expect(message).not.toContain('private diagnostic');
});
