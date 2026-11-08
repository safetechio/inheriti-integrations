import { describe, expect, it } from 'vitest';
import { parseUseOptions } from '../src/commands/arguments.js';
import { automationEnvironmentContext } from '../src/commands/operation-context.js';

describe('automation operation context', () => {
  it('parses only pre-command context flags and rejects duplicates and controls', () => {
    expect(parseUseOptions(['--env', 'TOKEN=asset.field', '--reason', 'Deploy', '--commit', 'abcdef0', '--', 'echo', '--target', 'child'], 'secrets exec'))
      .toMatchObject({ operationContext: { reason: 'Deploy', commitSha: 'abcdef0' }, command: ['echo', '--target', 'child'] });
    expect(parseUseOptions(['--reason', 'a', '--reason', 'b', '--', 'echo'], 'secrets exec')).toHaveProperty('error');
    expect(parseUseOptions(['--reason', 'a\nb', '--', 'echo'], 'secrets exec')).toHaveProperty('error');
    expect(parseUseOptions(['--commit', 'not-a-sha', '--', 'echo'], 'secrets exec')).toHaveProperty('error');
    expect(parseUseOptions(['--reason', 'Deploy', '--', 'echo'], 'plans use')).toHaveProperty('error');
  });

  it('uses only named environment fields and lets explicit flags override them', () => {
    const environment = {
      GITHUB_SHA: 'abcdef0123456', GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/deploy.yml@refs/heads/main',
      GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2', RANDOM_SECRET: 'not copied', INHERITI_AUTOMATION_TARGET: 'old',
    };
    expect(automationEnvironmentContext(environment, { target: 'new' })).toEqual({
      commitSha: 'abcdef0123456', workflow: environment.GITHUB_WORKFLOW_REF,
      pipeline: 'https://github.com/owner/repo/actions/runs/123/attempts/2',
    });
    expect(() => automationEnvironmentContext({ INHERITI_AUTOMATION_REASON: 'bad\nreason' })).toThrow();
    expect(automationEnvironmentContext({ GITHUB_SERVER_URL: 'file:///tmp', GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123' })).toEqual({});
    expect(automationEnvironmentContext({ ...environment, INHERITI_AUTOMATION_PROVIDER: 'AWS' })).toEqual({ target: 'old' });
  });
});
