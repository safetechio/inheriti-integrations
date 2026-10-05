import { describe, expect, it } from 'vitest';
import { LocalPlanAssistant } from '../src/local-plan-assistant.js';
import { LocalPlanSource } from '../src/local-plan-source.js';

const parse = (id: string, text: string) => LocalPlanSource.parse(id, text).value;
const signal = () => new AbortController().signal;

describe('local plan candidate group mapper', () => {
  it('keeps an absolute private key path as text without treating it as key content', async () => {
    const source = parse('chat', 'private key path: /tmp/example_only/id_ed25519');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ groups: [{ name: 'SSH', fields: [
      { role: 'privateKey', valueId: 'v0' },
    ] }] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ asset: { type: 'PLAIN-TEXT', fields: { text: { sourceId: 'chat' } } } });
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(assistant.confirm(draft, [source]).asset.secret.text).toBe('/tmp/example_only/id_ed25519');
  });
  it('does not map conflicting AWS key labels to username and password fields', async () => {
    const source = parse('env', 'AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=synthetic-access\nAWS_SECRET_ACCESS_KEY=synthetic-secret');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ planName: 'AWS', assignments: [
      { group: 'AWS', role: 'username' }, { group: 'AWS', role: 'password' }, { group: 'AWS', role: 'password' },
    ] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect('assets' in draft && draft.assets?.map((asset) => asset.type)).toEqual(['PLAIN-TEXT', 'PLAIN-TEXT', 'PLAIN-TEXT']);
    expect('assets' in draft && draft.assets?.map((asset) => asset.name)).toEqual([
      'Aws Region', 'Aws Access Key Id', 'Aws Secret Access Key',
    ]);
  });

  it('does not publish an unverified masked title in another language', async () => {
    const source = parse('chat', 'Plantitel: Marketing\nGitHub password: synthetic-password');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ planName: 'v0', assignments: [
      { group: '', role: 'unknown' }, { group: 'GitHub', role: 'password' },
    ] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ asset: { type: 'USER-PSWD', name: 'GitHub' } });
    expect('title' in draft && draft.title).not.toBe('Marketing');
    expect(JSON.stringify(draft)).not.toContain('synthetic-password');
  });

  it('maps positional assignments while keeping explicit plan metadata out of assets', async () => {
    const source = parse('chat', 'Plan name: Marketing\nFacebook username: synthetic-fb-user\nFacebook password: synthetic-fb-password\nInstagram password: synthetic-ig-password');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ planName: 'v0', assignments: [
      { group: '', role: 'unknown' }, { group: 'Facebook', role: 'username' },
      { group: 'Facebook', role: 'password' }, { group: 'Instagram', role: 'password' },
    ] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ title: 'Marketing', assets: [
      { type: 'USER-PSWD', name: 'Facebook' }, { type: 'USER-PSWD', name: 'Instagram' },
    ] });
    expect(JSON.stringify(draft)).not.toContain('synthetic-');
  });

  it('uses a plan name inferred from free text with positional assignments', async () => {
    const source = parse('env', 'AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=synthetic-access\nAWS_SECRET_ACCESS_KEY=synthetic-secret\nCoachy credentials is the plan name');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ planName: 'Coachy credentials', assignments: [
      { group: 'AWS', role: 'region' }, { group: 'AWS', role: 'accessKeyId' }, { group: 'AWS', role: 'secretAccessKey' },
    ] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ title: 'Coachy credentials', assets: [
      { type: 'PLAIN-TEXT' }, { type: 'PLAIN-TEXT' }, { type: 'PLAIN-TEXT' },
    ] });
    expect(JSON.stringify(draft)).not.toContain('synthetic-');
  });

  it('keeps all candidates when positional output has the wrong length', async () => {
    const source = parse('env', 'FIRST=synthetic-first\nSECOND=synthetic-second');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ assignments: [{ group: '', role: 'unknown' }] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ assets: [{ type: 'PLAIN-TEXT' }, { type: 'PLAIN-TEXT' }] });
  });

  it('resolves a masked plan title and two account groups from model IDs', async () => {
    const source = parse('chat', 'Plan name: Marketing\nFacebook username: synthetic-fb-user\nFacebook password: synthetic-fb-password\nInstagram username: synthetic-ig-user\nInstagram password: synthetic-ig-password');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ planName: 'v0', groups: [
      { name: 'Facebook', service: 'Facebook', fields: [{ role: 'username', valueId: 'v1' }, { role: 'password', valueId: 'v2' }] },
      { name: 'Instagram', service: 'Instagram', fields: [{ role: 'username', valueId: 'v3' }, { role: 'password', valueId: 'v4' }] },
    ], ignored: [] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ title: 'Marketing', assets: [
      { type: 'USER-PSWD', name: 'Facebook' }, { type: 'USER-PSWD', name: 'Instagram' },
    ] });
    expect(JSON.stringify(draft)).not.toContain('synthetic-');
  });

  it('maps username, password, and URL candidates to one USER-PSWD asset', async () => {
    const source = parse('env', 'USERNAME=synthetic-user\nPASSWORD=synthetic-password\nLOGIN_URL=https://example.test/login');
    let seenCandidates: unknown;
    const assistant = new LocalPlanAssistant({ infer: async request => {
      seenCandidates = request.candidates;
      const candidates = request.candidates!;
      return { title: 'Model title', groups: [{ name: 'Console login', members: [
        { id: candidates[0]!.id, role: 'username' },
        { id: candidates[1]!.id, role: 'password' },
        { id: candidates[2]!.id, role: 'appOrWebsite' },
      ] }] };
    } });

    const draft = await assistant.suggest([source], null, signal());
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(seenCandidates).toEqual([
      { id: 'v0', label: 'USERNAME' },
      { id: 'v1', label: 'PASSWORD' },
      { id: 'v2', label: 'LOGIN_URL' },
    ]);
    expect(draft).toMatchObject({ title: 'Model title', asset: {
      type: 'USER-PSWD', name: 'Console login', fields: {
        username: { sourceId: 'env', key: 'USERNAME' },
        password: { sourceId: 'env', key: 'PASSWORD' },
        appOrWebsite: { sourceId: 'env', key: 'LOGIN_URL' },
      },
    } });
    expect(JSON.stringify(draft)).not.toContain('synthetic-');
    expect(assistant.confirm(draft, [source]).asset.secret).toEqual({
      username: 'synthetic-user', password: 'synthetic-password', appOrWebsite: 'https://example.test/login',
    });
  });

  it('keeps AWS access key candidates as separate plain-text assets', async () => {
    const source = parse('env', 'AWS_ACCESS_KEY_ID=synthetic-access\nAWS_SECRET_ACCESS_KEY=synthetic-secret');
    const assistant = new LocalPlanAssistant({ infer: async request => {
      const candidates = request.candidates!;
      return { title: 'AWS credentials', groups: [{ name: 'AWS credentials', members: [
        { id: candidates[0]!.id, role: 'apiKey' },
        { id: candidates[1]!.id, role: 'apiKey' },
      ] }] };
    } });

    const draft = await assistant.suggest([source], null, signal());
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft).toMatchObject({ title: 'AWS credentials', assets: [
      { type: 'PLAIN-TEXT', name: 'Aws Access Key Id', fields: { text: { sourceId: 'env', key: 'AWS_ACCESS_KEY_ID' } } },
      { type: 'PLAIN-TEXT', name: 'Aws Secret Access Key', fields: { text: { sourceId: 'env', key: 'AWS_SECRET_ACCESS_KEY' } } },
    ] });
    expect(JSON.stringify(draft)).not.toContain('synthetic-');
    expect(assistant.confirm(draft, [source]).assets.map(asset => asset.secret)).toEqual([
      { text: 'synthetic-access' },
      { text: 'synthetic-secret' },
    ]);
  });

  it('keeps catalog-recognized values reviewable when the model ignores every candidate', async () => {
    const source = parse('env', 'AWS_ACCESS_KEY_ID=synthetic-access\nAWS_SECRET_ACCESS_KEY=synthetic-secret');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ assignments: [
      { group: '', role: 'unknown' }, { group: '', role: 'unknown' },
    ] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ assets: [
      { type: 'PLAIN-TEXT', fields: { text: { sourceId: 'env', key: 'AWS_ACCESS_KEY_ID' } } },
      { type: 'PLAIN-TEXT', fields: { text: { sourceId: 'env', key: 'AWS_SECRET_ACCESS_KEY' } } },
    ] });
  });

  it.each([
    ['unknown candidate ID', (_ids: string[]) => [{ id: 'missing', role: 'password' }]],
    ['duplicate candidate ID', (ids: string[]) => [{ id: ids[0]!, role: 'password' }, { id: ids[0]!, role: 'username' }]],
  ])('falls back to plain text for %s without exposing source values', async (_label, membersFor) => {
    const source = parse('env', 'USERNAME=synthetic-user\nPASSWORD=synthetic-password');
    const assistant = new LocalPlanAssistant({ infer: async request => ({
      title: 'Unsafe model title', groups: [{ name: 'Unsafe group', members: membersFor(request.candidates!.map(candidate => candidate.id)) }],
    }) });

    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ title: 'Unsafe model title', assets: [
      { type: 'PLAIN-TEXT', name: 'Username' }, { type: 'PLAIN-TEXT', name: 'Password' },
    ] });
    expect(JSON.stringify(draft)).not.toContain('synthetic-');
  });

  it('prefers an explicit plan name over the model title', async () => {
    const env = parse('env', 'USERNAME=synthetic-user\nPASSWORD=synthetic-password');
    const metadata = parse('metadata', 'Plan name: Explicit recovery');
    const assistant = new LocalPlanAssistant({ infer: async request => {
      const candidates = request.candidates!;
      return { planName: '', planNameValueId: candidates[2]!.id, ignored: [candidates[2]!.id], groups: [{ name: 'Login', fields: [
        { valueId: candidates[0]!.id, role: 'username' }, { valueId: candidates[1]!.id, role: 'password' },
      ] }] };
    } });

    const draft = await assistant.suggest([env, metadata], null, signal());
    expect(draft).toMatchObject({ title: 'Explicit recovery', asset: { type: 'USER-PSWD' } });
  });

  it('keeps equal secret text at distinct offsets as distinct candidates', async () => {
    const source = parse('chat', 'token: "same-secret"\nsecret: "same-secret"');
    const assistant = new LocalPlanAssistant({ infer: async request => {
      const candidates = request.candidates!;
      return { title: 'Repeated values', groups: candidates.map(candidate => ({ name: candidate.label, members: [{ id: candidate.id, role: 'unknown' }] })) };
    } });

    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ title: 'Repeated values', assets: [
      { type: 'PLAIN-TEXT', fields: { text: { sourceId: 'chat' } } },
      { type: 'PLAIN-TEXT', fields: { text: { sourceId: 'chat' } } },
    ] });
    if (!('assets' in draft)) throw new Error('Expected grouped assets');
    const refs = draft.assets.map(asset => asset.fields.text);
    expect(refs[0]).not.toEqual(refs[1]);
    expect(assistant.confirm(draft, [source]).assets.map(asset => asset.secret)).toEqual([
      { text: 'same-secret' }, { text: 'same-secret' },
    ]);
  });

  it('keeps a recovery code beside the grouped account asset', async () => {
    const source = parse('chat', 'username: "synthetic-user"\npassword: "synthetic-password"\nrecovery code: "synthetic-recovery"');
    const assistant = new LocalPlanAssistant({ infer: async request => {
      const candidates = request.candidates!;
      return { title: 'Account recovery', groups: [{ name: 'Account', members: candidates.map(candidate => ({
        id: candidate.id,
        role: /username/iu.test(candidate.label) ? 'username' : /password/iu.test(candidate.label) ? 'password' : 'code',
      })) }] };
    } });

    const draft = await assistant.suggest([source], null, signal());
    if (!('assets' in draft)) throw new Error('Expected grouped assets');
    expect(draft.assets.map(asset => asset.type)).toEqual(['USER-PSWD', 'PLAIN-TEXT']);
    expect(JSON.stringify(draft)).not.toContain('synthetic-');
    expect(assistant.confirm(draft, [source]).assets.map(asset => asset.secret)).toEqual([
      { username: 'synthetic-user', password: 'synthetic-password' },
      { text: 'synthetic-recovery' },
    ]);
  });

  it('passes opaque values in comma-separated prose to the model with masked values', async () => {
    const source = parse('chat', 'password is alpha-secret, token is beta-secret\nAPI_KEY=synthetic-api-key');
    let requestSources: unknown;
    let requestCandidates: readonly { id: string; label: string }[] = [];
    const assistant = new LocalPlanAssistant({ infer: async request => {
      requestSources = request.sources;
      requestCandidates = request.candidates!;
      return { title: 'Service credentials', groups: request.candidates!.map(candidate => ({
        name: candidate.label,
        members: [{ id: candidate.id, role: 'unknown' }],
      })) };
    } });

    const draft = await assistant.suggest([source], null, signal());
    expect(requestCandidates.map(candidate => candidate.id)).toEqual(['v0', 'v1', 'v2']);
    expect(JSON.stringify(requestSources)).not.toContain('alpha-secret');
    expect(JSON.stringify(requestSources)).not.toContain('beta-secret');
    expect(JSON.stringify(requestSources)).not.toContain('synthetic-api-key');
    expect('assets' in draft ? draft.assets : []).toHaveLength(3);
  });

  it('maps one quoted password candidate and confirms its exact source value', async () => {
    const source = parse('chat', 'password: "alpha-secret" for my account');
    const assistant = new LocalPlanAssistant({ infer: async request => ({
      title: 'Account access', groups: [{ name: 'Account', members: [{ id: request.candidates![0]!.id, role: 'password' }] }],
    }) });

    const draft = await assistant.suggest([source], null, signal());
    expect(draft).toMatchObject({ title: 'Account access', asset: { type: 'USER-PSWD', fields: { password: { sourceId: 'chat' } } } });
    expect(JSON.stringify(draft)).not.toContain('alpha-secret');
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(assistant.confirm(draft, [source]).asset.secret).toEqual({ password: 'alpha-secret' });
  });

  it('lets the model ignore metadata candidates without creating metadata assets', async () => {
    const source = parse('chat', 'Plan description: "synthetic-description"\nAssets: "synthetic-assets"\npassword: "alpha-secret"');
    let candidates: readonly { id: string; label: string }[] = [];
    const assistant = new LocalPlanAssistant({ infer: async request => {
      candidates = request.candidates!;
      return { planName: 'Recovery plan', groups: [{ name: 'Account', fields: [{ valueId: candidates[2]!.id, role: 'password' }] }],
        ignored: [candidates[0]!.id, candidates[1]!.id] };
    } });

    const draft = await assistant.suggest([source], null, signal());
    expect(candidates.map(({ label }) => label)).toEqual(['Plan description', 'Assets', 'password']);
    expect(draft).toMatchObject({ title: 'Recovery plan', asset: { type: 'USER-PSWD' } });
  });

  it('never publishes a model-selected secret as the plan title', async () => {
    const source = parse('chat', 'Vault material: alpha-secret\nTOKEN=beta-secret');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ planName: 'v0', ignored: ['v0'],
      groups: [{ name: 'Token', fields: [{ role: 'unknown', valueId: 'v1' }] }] }) });
    const draft = await assistant.suggest([source], null, signal());
    expect('title' in draft && draft.title).not.toBe('alpha-secret');
    expect(JSON.stringify(draft)).not.toContain('alpha-secret');
    expect(draft.unassignedSources).toContain('chat');
  });

  it('does not create assets when every candidate is context', async () => {
    const source = parse('chat', 'Ticket: synthetic-ticket\nEnvironment: synthetic-environment');
    const assistant = new LocalPlanAssistant({ infer: async request => ({ planName: 'Notes', groups: [],
      ignored: request.candidates!.map(({ id }) => id) }) });
    const result = await assistant.suggest([source], null, signal());
    expect(result).not.toHaveProperty('asset');
    expect(result).toMatchObject({ unassignedSources: ['chat'] });
  });

  it('handles inconsistent ignored IDs and keeps every AWS candidate', async () => {
    const source = parse('env', 'AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=synthetic-access\nAWS_SECRET_ACCESS_KEY=synthetic-secret\nAWS_S3_BUCKET=synthetic-bucket\nAWS_SQS_QUEUE_URL=https://example.test/jobs\nCoachy credentials is the plan name');
    const assistant = new LocalPlanAssistant({ infer: async request => ({ planName: 'Coachy credentials',
      groups: [{ name: 'AWS', service: 'AWS', fields: request.candidates!.map(({ id }) => ({ role: 'unknown', valueId: id })) }],
      ignored: request.candidates!.map(({ id }) => id) }) });
    const draft = await assistant.suggest([source], null, signal());
    expect('assets' in draft && draft.assets?.map((asset) => asset.name)).toEqual([
      'Aws Region', 'Aws Access Key Id', 'Aws Secret Access Key', 'Aws S3 Bucket', 'Aws Sqs Queue Url',
    ]);
    expect(draft.unassignedSources).toEqual([]);
  });

  it('preserves punctuation and mixed alphanumeric tokens exactly', async () => {
    const source = parse('chat', 'Protect my password alpha-beta! and token XYZ123456\nAPI_KEY=gamma-secret');
    const assistant = new LocalPlanAssistant({ infer: async request => {
      expect(JSON.stringify(request.sources)).not.toMatch(/alpha-beta|XYZ123456|gamma-secret/u);
      return { planName: 'Credentials',
        groups: request.candidates!.map(({ id }) => ({ name: 'Value', fields: [{ role: 'unknown', valueId: id }] })), ignored: [] };
    } });
    const draft = await assistant.suggest([source], null, signal());
    if (!('assets' in draft)) throw new Error('Expected multiple assets');
    expect(assistant.confirm(draft, [source]).assets.map((asset) => asset.secret.text)).toEqual([
      'alpha-beta!', 'XYZ123456', 'gamma-secret',
    ]);
  });
});
