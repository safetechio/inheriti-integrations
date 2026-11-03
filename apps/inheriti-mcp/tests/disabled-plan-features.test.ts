import { expect, it } from 'vitest';
import { MetadataTools } from '../src/server.js';

it.each(['local', 'dev', 'stg', 'prod'])('blocks direct MCP plan methods before auth in %s', async deployment => {
  const tools = new MetadataTools();
  tools.config = { deployment, apiUrl: 'https://unused.invalid', issuer: 'https://unused.invalid',
    clientId: 'test', environment: 'TEST', redirectUri: 'http://127.0.0.1' };
  await expect(tools.createPlanWithAssistant()).rejects.toMatchObject({ code: 'plan_creation_unavailable' });
  await expect(tools.planCreationStatus('job')).rejects.toMatchObject({ code: 'plan_creation_unavailable' });
  await expect(tools.reveal('plan', 'asset.field')).rejects.toMatchObject({ code: 'plan_reveal_unavailable' });
  await expect(tools.revealFields('plan', { selector: 'asset.field' })).rejects.toMatchObject({ code: 'plan_reveal_unavailable' });
  await expect(tools.startReveal('plan', { kind: 'FIELD', single: true })).rejects.toMatchObject({ code: 'plan_reveal_unavailable' });
  await expect(tools.revealStatus('job')).rejects.toMatchObject({ code: 'plan_reveal_unavailable' });
  await expect(tools.publishPlanFieldsToAws({ planId: 'plan', region: 'us-east-1', expectedAccountId: '123',
    mappings: [], apply: false })).rejects.toMatchObject({ code: 'plan_reveal_unavailable' });
  await expect(tools.publishPlanFieldsToGoogleCloud({ planId: 'plan', projectId: 'project', secretPrefix: '',
    mappings: [], apply: false })).rejects.toMatchObject({ code: 'plan_reveal_unavailable' });
});
