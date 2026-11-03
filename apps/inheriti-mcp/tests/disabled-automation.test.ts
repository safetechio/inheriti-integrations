import { expect, it, vi } from 'vitest';
import { MetadataTools } from '../src/server.js';

it.each(['local', 'dev', 'stg', 'prod'])('blocks direct MCP automation methods before auth in %s', async deployment => {
  const tools = new MetadataTools() as any;
  tools.config = { deployment, apiUrl: 'https://unused.invalid' };
  const selected = vi.spyOn(tools, 'selected');
  for (const [method, args] of [
    ['automationOperations', []], ['listAutomationConnections', []], ['listAutomationGrants', ['plan']],
    ['listAutomationMembers', []], ['getAutomationRuntimeInstallInstructions', []],
    ['githubAutomationUsage', ['plan', 'connection', 'selector']],
    ['createAutomationConnection', [{}]], ['changeAutomationTrust', ['connection', {}]],
    ['disableAutomationConnection', ['connection']], ['manageAutomationGrant', ['create', 'plan', {}]],
    ['startAutomationSetup', ['connection']], ['automationSetupStatus', ['job']],
    ['startAutomationPairing', ['connection']], ['pairAwsAutomationService', [{}]],
    ['pairGoogleAutomationService', [{}]], ['prepareAutomationEc2', [{}]],
    ['prepareAutomationRuntime', [{}]], ['applyAutomationRuntime', [{ cliPath: '/cli', expectedRevision: 'revision', image: 'image' }]],
  ] as const) {
    await expect(tools[method](...args), method).rejects.toMatchObject({ code: 'automation_local_only' });
  }
  expect(selected).not.toHaveBeenCalled();
});
