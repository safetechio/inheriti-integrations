import { describe, expect, it } from 'vitest';
import { githubAutomationDevWorkflow, githubDevArtifactSecretName, isManagedGithubDevWorkflow } from '../src/github-dev-workflow.js';

const id = '00000000-0000-4000-8000-000000000002';
const input = { environment: 'Production EU', planId: id, connectionId: id, selector: 'account.password',
  artifact: { cliVersion: '0.0.24-dev.3', sha256: 'a'.repeat(64), downloadOrigin: 'https://downloads.example' } };

describe('GitHub DEV workflow', () => {
  it('pins the private artifact in both isolated jobs and correlates pairing runs', () => {
    const yaml = githubAutomationDevWorkflow(input);
    expect(yaml.split('\n')[0]).toContain('# inheriti-dev-workflow: ');
    expect(yaml).toContain("format('Inheriti pairing {0}', inputs.pairing_attempt)");
    expect(yaml).toContain('      pair_inheriti:\n        type: boolean\n        default: false');
    expect(yaml).toContain('      pairing_attempt:\n        type: string');
    expect(yaml).toContain("  push:\n    paths:\n      - '.github/workflows/**'");
    expect(yaml).toContain("  pair-inheriti:\n    if: ${{ github.event_name == 'workflow_dispatch' && inputs.pair_inheriti }}");
    expect(yaml).toContain("  use-secret:\n    if: ${{ github.event_name == 'workflow_dispatch' && !inputs.pair_inheriti }}");
    expect(yaml.match(/container: node:22-bookworm-slim/g)).toHaveLength(2);
    expect(yaml.match(/npm install --global --engine-strict \/tmp\/inheriti-cli.tgz/g)).toHaveLength(2);
    expect(yaml).toContain(`secrets.${githubDevArtifactSecretName(id)}`);
    expect(yaml).toContain("url.origin !== \"https://downloads.example\"");
    expect(yaml).toContain(`'${'a'.repeat(64)}'`);
    expect(yaml).toContain("test \"$(inheriti --version)\" = '0.0.24-dev.3'");
    expect(yaml).toContain('inheriti automations pair redeem');
    expect(yaml).toContain(`inheriti secrets exec ${id} --automation --env INHERITI_SECRET=account.password`);
    expect(yaml).not.toContain('integrations/github-actions@');
    expect(yaml).not.toContain('npm install --global --engine-strict @safetech/inheriti-cli@');
    expect(yaml).not.toContain('token=');
  });

  it('rejects non DEV versions, unsafe artifact details, and malformed identities', () => {
    for (const cliVersion of ['0.0.24', '0.0.24-stg.1', 'latest', '0.0.24-dev.01'])
      expect(() => githubAutomationDevWorkflow({ ...input, artifact: { ...input.artifact, cliVersion } })).toThrow();
    for (const downloadOrigin of ['http://downloads.example', 'https://u:p@downloads.example', 'https://downloads.example/path',
      'https://downloads.example?token=secret', 'https://downloads.example/#hash'])
      expect(() => githubAutomationDevWorkflow({ ...input, artifact: { ...input.artifact, downloadOrigin } })).toThrow();
    expect(() => githubAutomationDevWorkflow({ ...input, artifact: { ...input.artifact, sha256: 'bad' } })).toThrow();
    expect(() => githubAutomationDevWorkflow({ ...input, environment: 'prod\nsecret: value' })).toThrow();
    expect(() => githubAutomationDevWorkflow({ ...input, connectionId: 'bad' })).toThrow();
  });

  it('recognizes only unchanged generated content for the selected connection', () => {
    const yaml = githubAutomationDevWorkflow(input);
    expect(isManagedGithubDevWorkflow(yaml, id)).toBe(true);
    expect(isManagedGithubDevWorkflow(yaml.replace('node:22-bookworm-slim', 'node:20'), id)).toBe(false);
    expect(isManagedGithubDevWorkflow(yaml, '00000000-0000-4000-8000-000000000003')).toBe(false);
    const refreshed = githubAutomationDevWorkflow({ ...input, artifact: { ...input.artifact, sha256: 'b'.repeat(64) } });
    expect(isManagedGithubDevWorkflow(refreshed, id)).toBe(true);
  });
});
