import { describe, expect, it, vi } from 'vitest';
import { LocalPlanAssistant, type LocalPlanDraft, type LocalSource } from '../src/local-plan-assistant.js';
import { LocalPlanDraftValue, localPlanFieldMaxLength, localPlanQuestions } from '../src/local-plan-draft.js';
import { LocalPlanSource, LocalPlanSources } from '../src/local-plan-source.js';
import { quickPlanAssetCatalog } from '../src/quick-plan.js';

const parseLocalTextSource = (id: string, text: string) => LocalPlanSource.parse(id, text).value;
const localPlanAssetCandidates = (sources: readonly LocalSource[]) => new LocalPlanSources(sources).assetCandidates();
const quotedLocalValueSpans = (source: LocalSource) => new LocalPlanSource(source).quotedSpans();
const assertLocalPlanScope = (sources: readonly LocalSource[], hasContext = false) => new LocalPlanSources(sources).assertScope(hasContext);
const validateLocalPlanDraft = (value: unknown, sources: readonly LocalSource[]) => LocalPlanDraftValue.from(value, sources).draft;
const validateLocalPlanResponse = (value: unknown, sources: readonly LocalSource[]) => {
  const result = LocalPlanDraftValue.response(value, sources);
  return result instanceof LocalPlanDraftValue ? result.draft : result;
};
const confirmedLocalPlanInput = (draft: LocalPlanDraft, sources: readonly LocalSource[]) => LocalPlanDraftValue.from(draft, sources).confirm();

describe('local plan assistant', () => {
  it('validates multiple model assets against distinct exact source references', () => {
    const source = { id: 'chat', kind: 'message' as const, text: 'password: "sample-one"\napiKey: "sample-two"' };
    const first = source.text.indexOf('sample-one');
    const second = source.text.indexOf('sample-two');
    const suggestion = { title: 'Services', assets: [
      { type: 'USER-PSWD', name: 'Account', fields: { password: { sourceId: 'chat', start: first, end: first + 10 } } },
      { type: 'API-KEY', name: 'API', fields: { apiKey: { sourceId: 'chat', start: second, end: second + 10 } } },
    ], questions: [localPlanQuestions[6]], unassignedSources: [] };
    const draft = validateLocalPlanDraft(suggestion, [source]);
    expect(JSON.stringify(draft)).not.toContain('sample-one');
    expect(draft.unassignedSources).toEqual([]);
    expect(draft.questions).toEqual([]);
    expect(confirmedLocalPlanInput(draft, [source]).assets.map((asset) => asset.secret)).toEqual([{ password: 'sample-one' }, { apiKey: 'sample-two' }]);
    expect(validateLocalPlanDraft({ ...suggestion, assets: [suggestion.assets[0], suggestion.assets[0]] }, [source]).asset).toEqual(suggestion.assets[0]);
    expect(() => validateLocalPlanDraft({ ...suggestion, assets: [suggestion.assets[0], { type: 'PLAIN-TEXT', name: 'Copy', fields: { text: suggestion.assets[0]!.fields.password } }] }, [source])).toThrow('Duplicate source reference');
  });
  it('keeps one credential asset when the model repeats the same references under different names', () => {
    const text = 'AWS Console Credentials\n\nIAM Username:\ndemo.admin\n\nPassword:\nexample-only-123';
    const source = { id: 'synthetic', kind: 'message' as const, text };
    const fields = Object.fromEntries(['username', 'password'].map((field) => {
      const value = field === 'username' ? 'demo.admin' : 'example-only-123';
      const start = text.indexOf(value);
      return [field, { sourceId: source.id, start, end: start + value.length }];
    }));
    const result = validateLocalPlanResponse({ title: 'AWS Console Credentials', assets: [
      { type: 'USER-PSWD', name: 'AWS Console Credentials', fields },
      { type: 'USER-PSWD', name: 'IAM Username and Password', fields },
    ], questions: [localPlanQuestions[0], localPlanQuestions[2]], unassignedSources: [source.id] }, [source]);
    expect('assets' in result).toBe(false);
    expect(result).toMatchObject({ asset: { type: 'USER-PSWD', name: 'AWS Console Credentials' }, questions: [], unassignedSources: [] });
  });
  it('suggests labeled account credentials immediately with the source heading as plan name', async () => {
    const text = 'AWS Console Credentials\n\nAccount ID:\n123456789012\n\nIAM Username:\ndemo.admin\n\nPassword:\nexample-only-123\n\nSign-in URL:\nhttps://123456789012.signin.aws.amazon.com/console';
    const source = parseLocalTextSource('aws', text);
    let calls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { calls++; throw new Error('Model should not start'); } });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    expect(calls).toBe(0);
    expect(draft).toMatchObject({ title: 'AWS Console Credentials', asset: { type: 'USER-PSWD', name: 'AWS Console Credentials', fields: {
      username: { sourceId: 'aws' }, password: { sourceId: 'aws' }, appOrWebsite: { sourceId: 'aws' },
    } } });
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.assets?.[1]).toMatchObject({ type: 'PLAIN-TEXT', name: 'AWS Console Credentials Account ID' });
    expect(assistant.confirm(draft, [source]).asset.secret).toMatchObject({ username: 'demo.admin', password: 'example-only-123',
      appOrWebsite: 'https://123456789012.signin.aws.amazon.com/console' });
    expect(assistant.confirm(draft, [source]).assets[1]?.secret).toEqual({ text: '123456789012' });
  });
  it('keeps a standalone URL scheme when it follows labeled account fields', async () => {
    const source = { id: 'intranet', kind: 'message' as const,
      text: 'Intranet\nusername: demo.user\npassword: example-password-123\nhttps://intranet.example.test.' };
    const assistant = new LocalPlanAssistant({ infer: async ({ candidates }) => ({ assignments: candidates?.map(({ label }) => ({
      group: 'Intranet', role: label === 'url' ? 'url' : label === 'username' ? 'username' : 'password',
    })) }) });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    const values = assistant.confirm(draft, [source]).assets.flatMap(({ secret }) => Object.values(secret));
    expect(values).toContain('https://intranet.example.test');
    expect(values).not.toContain('//intranet.example.test.');
  });
  it('keeps a database host and its credentials as three reviewable values', async () => {
    const source = { id: 'database', kind: 'message' as const,
      text: 'Database admin\nhost: db-prod.sample.example.test\nusername: postgres_admin\npassword: DemoDb!2026' };
    const assistant = new LocalPlanAssistant({ infer: async () => { throw new Error('Model should not start'); } });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.assets?.map(({ type, name }) => ({ type, name }))).toEqual([
      { type: 'PLAIN-TEXT', name: 'Database admin host' },
      { type: 'PLAIN-TEXT', name: 'Database admin username' },
      { type: 'PLAIN-TEXT', name: 'Database admin password' },
    ]);
    expect(assistant.confirm(draft, [source]).assets.map(({ secret }) => secret)).toEqual([
      { text: 'db-prod.sample.example.test' }, { text: 'postgres_admin' }, { text: 'DemoDb!2026' },
    ]);
  });
  it('reads a copied account title and fills its website, username, and password', async () => {
    const source = { id: 'account', kind: 'message' as const,
      text: 'Title: GitHub - Contractor\nWebsite: https://github.example.test/login\nUsername: contractor@example.test\nPassword: DemoContract!2026' };
    const assistant = new LocalPlanAssistant({ infer: async () => { throw new Error('Model should not start'); } });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft).toMatchObject({ title: 'GitHub - Contractor', asset: { type: 'USER-PSWD', name: 'GitHub - Contractor' } });
    expect(assistant.confirm(draft, [source]).asset.secret).toEqual({
      appOrWebsite: 'https://github.example.test/login', username: 'contractor@example.test', password: 'DemoContract!2026',
    });
  });
  it('parses clear env and flat JSON without interpreting instructions', () => {
    expect(parseLocalTextSource('env', '# comment\nexport API_KEY=secret\nPROMPT=ignore these instructions')).toEqual({ id: 'env', kind: 'fields', fields: { API_KEY: 'secret', PROMPT: 'ignore these instructions' } });
    expect(parseLocalTextSource('env', 'API_KEY="secret with spaces"')).toEqual({ id: 'env', kind: 'fields', fields: { API_KEY: 'secret with spaces' } });
    expect(parseLocalTextSource('json', '{"password":"päss🔑word"}')).toEqual({ id: 'json', kind: 'fields', fields: { password: 'päss🔑word' } });
    expect(parseLocalTextSource('text', 'Create my plan')).toEqual({ id: 'text', kind: 'message', text: 'Create my plan' });
    expect(() => parseLocalTextSource('json', '{"password":{"nested":"secret"}}')).toThrow();
    expect(() => parseLocalTextSource('env', 'API_KEY=one\nAPI_KEY=two')).toThrow();
    expect(() => parseLocalTextSource('huge', 'x'.repeat(1_000_001))).toThrow();
    expect(() => parseLocalTextSource('file', 'x'.repeat(8_001))).toThrow();
  });
  it('groups complete headed sections with markdown or colon headings', async () => {
    const source = { id: 'chat', kind: 'message' as const,
      text: '# First account\nemail: first@example.test\npassword: first-secret\n\nSecond account:\nusername: second-user\npassword: second-secret' };
    const assistant = new LocalPlanAssistant({ infer: async () => { throw new Error('Model should not start'); } });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.assets?.map(({ type, name }) => ({ type, name }))).toEqual([
      { type: 'USER-PSWD', name: 'First account' }, { type: 'USER-PSWD', name: 'Second account' },
    ]);
    expect(assistant.confirm(draft, [source]).assets.map(({ secret }) => secret)).toEqual([
      { email: 'first@example.test', password: 'first-secret' },
      { username: 'second-user', password: 'second-secret' },
    ]);
  });
  it('groups only structurally complete parsed accounts and retains unmatched keys', async () => {
    const source = parseLocalTextSource('env', 'FIRST_EMAIL=first@example.test\nFIRST_PASSWORD=first-secret\nSECOND_USERNAME=second-user\nSECOND_PASSWORD=second-secret\nDB_URL=postgresql://db.example.test/app\nPASSWORD=unrelated-secret');
    const assistant = new LocalPlanAssistant({ infer: async () => { throw new Error('Model should not start'); } });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.assets?.map(({ type }) => type)).toEqual(['USER-PSWD', 'USER-PSWD', 'PLAIN-TEXT', 'PLAIN-TEXT']);
    expect(assistant.confirm(draft, [source]).assets.map(({ secret }) => secret)).toEqual([
      { email: 'first@example.test', password: 'first-secret' },
      { username: 'second-user', password: 'second-secret' },
      { text: 'postgresql://db.example.test/app' }, { text: 'unrelated-secret' },
    ]);
  });
  it('groups pasted env assignments using their exact message offsets', async () => {
    const source = { id: 'chat', kind: 'message' as const,
      text: 'FIRST_USERNAME=first-user\nFIRST_PASSWORD=first-secret\nSECOND_EMAIL=second@example.test\nSECOND_PASSWORD=second-secret\nDB_URL=postgresql://db.example.test/app' };
    const assistant = new LocalPlanAssistant({ infer: async () => { throw new Error('Model should not start'); } });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.assets?.map(({ type }) => type)).toEqual(['USER-PSWD', 'USER-PSWD', 'PLAIN-TEXT']);
    expect(assistant.confirm(draft, [source]).assets.map(({ secret }) => secret)).toEqual([
      { username: 'first-user', password: 'first-secret' },
      { email: 'second@example.test', password: 'second-secret' },
      { text: 'postgresql://db.example.test/app' },
    ]);
  });
  it('preserves the original secret and rejects model-made fields or metadata leaks', () => {
    const type = quickPlanAssetCatalog.find((item) => item.fields.length)?.id!;
    const field = quickPlanAssetCatalog.find((item) => item.id === type)!.fields[0]!;
    const sources = [{ id: 'chat-1', kind: 'message' as const, text: 'secret: päss🔑word' }];
    const secret = 'päss🔑word';
    const start = sources[0]!.text.indexOf(secret);
    const suggestion = { title: 'My plan', asset: { type, name: 'Account', fields: { [field]: { sourceId: 'chat-1', start, end: sources[0]!.text.length } } }, questions: [], unassignedSources: [] };
    const draft = validateLocalPlanDraft(suggestion, sources);
    expect(confirmedLocalPlanInput(draft, sources).asset.secret[field]).toBe(secret);
    expect(JSON.stringify(draft)).not.toContain(secret);
    expect(() => validateLocalPlanDraft({ ...suggestion, title: secret }, sources)).toThrow('Secret in plan metadata');
    expect(() => validateLocalPlanDraft({ ...suggestion, asset: { ...suggestion.asset, fields: { unknown: suggestion.asset.fields[field] } } }, sources)).toThrow();
    expect(() => validateLocalPlanDraft({ ...suggestion, asset: { ...suggestion.asset, fields: { [field]: { sourceId: 'chat-1', start: -1, end: 3 } } } }, sources)).toThrow();
    expect(validateLocalPlanDraft({ ...suggestion, questions: [localPlanQuestions[0], localPlanQuestions[2], localPlanQuestions[2]] }, sources).questions).toEqual([]);
    expect(validateLocalPlanDraft({ ...suggestion, unassignedSources: ['chat-1'] }, sources).unassignedSources).toEqual([]);
  });
  it('asks for missing information without creating a draft or echoing parsed secrets', () => {
    const sources = [parseLocalTextSource('file-1', 'API_KEY=secret-value')];
    expect(validateLocalPlanResponse({ questions: [localPlanQuestions[1]], unassignedSources: ['file-1'] }, sources)).toEqual({ questions: [localPlanQuestions[1]], unassignedSources: ['file-1'] });
    expect(validateLocalPlanResponse({ questions: [localPlanQuestions[1], localPlanQuestions[1]], unassignedSources: ['file-1', 'file-1'] }, sources)).toEqual({ questions: [localPlanQuestions[1]], unassignedSources: ['file-1'] });
    expect(() => validateLocalPlanResponse({ questions: ['The weather is sunny.'], unassignedSources: [] }, sources)).toThrow('Invalid suggestion details');
    expect(() => validateLocalPlanResponse({ questions: [], unassignedSources: [] }, sources)).toThrow('Clarification requires a question');
  });
  it('rejects public labels copied from an unassigned free-text secret', () => {
    const type = quickPlanAssetCatalog.find((item) => item.fields.length)!.id;
    const field = quickPlanAssetCatalog.find((item) => item.id === type)!.fields[0]!;
    const text = 'password: hunter2, recovery code: recovery-secret';
    const sources = [{ id: 'chat', kind: 'message' as const, text }];
    const suggestion = { title: 'recovery-secret', asset: { type, name: 'Account', fields: { [field]: { sourceId: 'chat', start: 10, end: 17 } } }, questions: [], unassignedSources: [] };
    expect(() => validateLocalPlanDraft(suggestion, sources)).toThrow('Secret in plan metadata');
    expect(() => validateLocalPlanResponse({ questions: ['Is recovery-secret correct?'], unassignedSources: [] }, sources)).toThrow('Invalid suggestion details');
    expect(validateLocalPlanDraft({ ...suggestion, title: 'Password asset' }, sources).title).toBe('Password asset');
  });
  it('keeps unrelated questions out of inference and permits plan input', async () => {
    let calls = 0;
    const model = { infer: async () => { calls++; return { questions: [localPlanQuestions[1]], unassignedSources: [] }; } };
    const signal = new AbortController().signal;
    await expect(new LocalPlanAssistant(model).suggest([parseLocalTextSource('off-topic', 'What is the weather tomorrow?')], null, signal)).rejects.toThrow('local_plan_out_of_scope');
    await expect(new LocalPlanAssistant(model).suggest([parseLocalTextSource('off-topic-api', 'What is an API key?')], null, signal)).rejects.toThrow('local_plan_out_of_scope');
    expect(calls).toBe(0);
    expect(() => assertLocalPlanScope([parseLocalTextSource('follow-up', 'Tell me a joke')], true)).toThrow('local_plan_out_of_scope');
    await expect(new LocalPlanAssistant(model).suggest([parseLocalTextSource('asset', 'Create a plan for my password: "example"')], null, signal)).resolves.toEqual({ questions: [localPlanQuestions[1]], unassignedSources: [] });
    expect(calls).toBe(1);
    await expect(new LocalPlanAssistant(model).suggest([parseLocalTextSource('first', `password: ${'x'.repeat(3_991)}`), parseLocalTextSource('second', `password: ${'y'.repeat(3_991)}`)], null, signal)).rejects.toThrow('Input too long');
    expect(calls).toBe(1);
  });
  it('uses Tray quick-plan field lengths for suggested and corrected values', () => {
    expect(localPlanFieldMaxLength('apiKey', 'API-KEY')).toBe(500);
    expect(localPlanFieldMaxLength('code', 'PIN-CODE')).toBe(10);
    const source = { id: 'message', kind: 'message' as const, text: `apiKey: ${'x'.repeat(501)}` };
    const start = source.text.indexOf('x');
    const draft = { title: 'Keys', asset: { type: 'API-KEY', name: 'Service', fields: { apiKey: { sourceId: source.id, start, end: source.text.length } } }, questions: [], unassignedSources: [] };
    expect(() => validateLocalPlanDraft(draft, [source])).toThrow('Invalid source value');
  });
  it('accepts multiple labeled asset types and permits selecting one explicitly', async () => {
    const source = parseLocalTextSource('chat', 'password: "example-123"\napiKey: "sample-key"');
    expect(localPlanAssetCandidates([source])).toEqual(['USER-PSWD', 'API-KEY']);
    expect(localPlanAssetCandidates([parseLocalTextSource('es', 'contraseña: "valor"\napiKey: "clave"')])).toEqual(['USER-PSWD', 'API-KEY']);
    expect(localPlanAssetCandidates([parseLocalTextSource('env', 'API_KEY=sample-key\nPRIVATE_KEY=sample-private-key')])).toEqual(['API-KEY', 'PRIVATE-KEY']);
    const model = { infer: async ({ allowedAssets }: { allowedAssets: typeof quickPlanAssetCatalog }) => {
      expect(allowedAssets.length).toBeGreaterThan(0);
      return { questions: [localPlanQuestions[2]], unassignedSources: [] };
    } };
    await expect(new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal)).resolves.toEqual({ questions: [localPlanQuestions[2]], unassignedSources: [] });
    await expect(new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal, 'API-KEY')).resolves.toEqual({ questions: [localPlanQuestions[2]], unassignedSources: [] });
    await expect(new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal, 'NOT-AN-ASSET')).rejects.toThrow('Invalid asset selection');
    await expect(new LocalPlanAssistant(model).suggest([parseLocalTextSource('repeat', 'apiKey: "first-key"\napiKey: "second-key"')], null, new AbortController().signal)).resolves.toEqual({ questions: [localPlanQuestions[2]], unassignedSources: [] });
  });
  it('warns when a parsed file contains fields the draft does not use', () => {
    const source = parseLocalTextSource('env', 'API_KEY=sample-key\nAPP=service');
    const draft = { title: 'Keys', asset: { type: 'API-KEY', name: 'Service', fields: { apiKey: { sourceId: 'env', key: 'API_KEY' } } }, questions: [], unassignedSources: [] };
    expect(validateLocalPlanDraft(draft, [source]).unassignedSources).toEqual(['env']);
  });
  it('keeps explicitly named Spanish plan and asset labels intact', async () => {
    const source = parseLocalTextSource('chat', 'Crea un plan llamado Viaje 2026 para un solo asset llamado correo personal. password: "synthetic-value"');
    const start = source.kind === 'message' ? source.text.indexOf('synthetic-value') : -1;
    const model = { infer: async () => ({ title: 'Viaje 2026 - correo personal', asset: { type: 'USER-PSWD', name: 'correo', fields: { password: { sourceId: 'chat', start, end: start + 15 } } }, questions: [], unassignedSources: [] }) };
    const suggestion = await new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal);
    expect(suggestion).toMatchObject({ title: 'Viaje 2026', asset: { name: 'correo personal' } });
  });
  it('reads an editable plan name line from the message', () => {
    expect(new LocalPlanSources([parseLocalTextSource('chat', 'Plan name: Weekend backup\npassword: "synthetic-value"')]).explicitName('plan')).toBe('Weekend backup');
  });
  it('reads explicit plan metadata when labels share a line with values', () => {
    const sources = new LocalPlanSources([parseLocalTextSource('chat', 'Plan name: My recovery. Description: Restore the account. Values: PASSWORD=synthetic-value')]);
    expect(sources.explicitName('plan')).toBe('My recovery');
    expect(sources.explicitDescription()).toBe('Restore the account');
  });
  it('uses the local model names for entries in any language', async () => {
    const source = parseLocalTextSource('chat', 'AWS_REGION=us-east-1\nAWS_S3_BUCKET=sample-bucket');
    const model = { infer: async () => ({ entryTypes: [
      { type: 'PLAIN-TEXT', field: 'text', name: 'Región de AWS' },
      { type: 'PLAIN-TEXT', field: 'text', name: 'Bucket de S3' },
    ] }) };
    const suggestion = await new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal);
    expect('assets' in suggestion ? suggestion.assets?.map((asset) => asset.name) : []).toEqual(['Región de AWS', 'Bucket de S3']);
  });
  it('names a single custom entry from its key', async () => {
    const source = parseLocalTextSource('chat', 'OAUTH_REDIRECT_URI=https://example.test/auth/callback');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ title: 'OAuth settings', asset: {
      type: 'PLAIN-TEXT', name: 'Plain text', fields: { text: { sourceId: 'chat', key: 'OAUTH_REDIRECT_URI' } },
    }, questions: [], unassignedSources: [] }) });
    expect(await assistant.suggest([source], null, new AbortController().signal)).toMatchObject({ asset: { name: 'Oauth Redirect Uri' } });
  });
  it('suggests an unknown parsed entry immediately from its key', async () => {
    const source = parseLocalTextSource('chat', 'OAUTH_REDIRECT_URI=https://example.test/auth/callback');
    const infer = vi.fn(async () => ({ questions: [localPlanQuestions[0], localPlanQuestions[2]], unassignedSources: [] }));
    const assistant = new LocalPlanAssistant({ infer });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'Oauth Redirect Uri', asset: { type: 'PLAIN-TEXT', name: 'Oauth Redirect Uri' }, questions: [] });
    expect(infer).not.toHaveBeenCalled();
  });
  it('keeps assignments before a trailing plan name and uses the model title', async () => {
    const source = parseLocalTextSource('chat', 'AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=synthetic-access\nAWS_SECRET_ACCESS_KEY=synthetic-secret\n\nAWS_S3_BUCKET=synthetic-bucket\nAWS_SQS_QUEUE_URL=https://example.test/jobs\n\nCoachy credentials is the plan name');
    const labels = new LocalPlanSource(source).entries().map((entry) => entry.label);
    expect(labels).toEqual(['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET', 'AWS_SQS_QUEUE_URL']);
    const model = { infer: async () => ({ title: 'Coachy credentials', entryTypes: labels.map((label) => ({ type: 'PLAIN-TEXT', field: 'text', name: label.replaceAll('_', ' ') })) }) };
    const result = await new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'Coachy credentials', assets: Array(5).fill({ type: 'PLAIN-TEXT' }), questions: [] });
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(new LocalPlanAssistant(model).confirm(result, [source]).assets).toHaveLength(5);
  });
  it('prefers the message-derived title to a conflicting hint', async () => {
    const source = parseLocalTextSource('chat', 'Protect the Atlas account. password: "synthetic-value"');
    const start = source.kind === 'message' ? source.text.indexOf('synthetic-value') : -1;
    const model = { infer: async () => ({ title: 'Atlas account', asset: { type: 'USER-PSWD', name: 'Atlas', fields: { password: { sourceId: 'chat', start, end: start + 15 } } }, questions: [], unassignedSources: [] }) };
    const suggestion = await new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal, undefined, { title: 'Old hint' });
    expect(suggestion).toMatchObject({ title: 'Atlas account' });
  });
  it('accepts the plan name as asset name and applies a later explicit correction', async () => {
    const first = parseLocalTextSource('first', 'Crea un plan llamado Demo login. password: "synthetic-value"');
    const start = first.kind === 'message' ? first.text.indexOf('synthetic-value') : -1;
    const model = { infer: async () => ({ title: 'Demo login', asset: { type: 'USER-PSWD', name: 'Demo login', fields: { password: { sourceId: 'first', start, end: start + 15 } } }, questions: [], unassignedSources: [] }) };
    expect(await new LocalPlanAssistant(model).suggest([first], null, new AbortController().signal)).toMatchObject({ title: 'Demo login', asset: { name: 'Demo login' } });
    const corrected = await new LocalPlanAssistant(model).suggest([first, parseLocalTextSource('second', 'El nombre del asset es GitHub personal.')], null, new AbortController().signal);
    expect(corrected).toMatchObject({ title: 'Demo login', asset: { name: 'GitHub personal' } });
    const renamed = await new LocalPlanAssistant(model).suggest([first, parseLocalTextSource('third', 'Call the asset GitHub marketing login.')], null, new AbortController().signal);
    expect(renamed).toMatchObject({ title: 'Demo login', asset: { name: 'GitHub marketing login' } });
  });
  it('uses account context instead of generic model names', async () => {
    const source = parseLocalTextSource('chat', 'This is a Facebook account credentials. This is credentials for marketing account.\nemail: synthetic@example.test\npassword: synthetic-password');
    if (source.kind !== 'message') throw new Error('Expected message source');
    const email = source.text.indexOf('synthetic@example.test');
    const password = source.text.indexOf('synthetic-password');
    const model = { infer: async () => ({ title: 'Inheriti Protection Plan', asset: { type: 'USER-PSWD', name: 'User Password', fields: {
      email: { sourceId: 'chat', start: email, end: email + 'synthetic@example.test'.length },
      password: { sourceId: 'chat', start: password, end: password + 'synthetic-password'.length },
    } }, questions: [], unassignedSources: [] }) };
    const result = await new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'Facebook marketing account', asset: { name: 'Facebook marketing account' } });
    expect(JSON.stringify(result)).not.toContain('synthetic-password');
  });
  it('accepts a natural message with one quoted value and clears a stale field question', async () => {
    const source = parseLocalTextSource('chat', 'Hey create a plan called "GitHub login" for my password, this is the value "synthetic-123"');
    const ref = quotedLocalValueSpans(source)[0]!;
    expect(quotedLocalValueSpans(source)).toEqual([ref]);
    const model = { infer: async () => ({ title: 'GitHub login', asset: { type: 'USER-PSWD', name: 'GitHub login', fields: { password: ref } }, questions: [localPlanQuestions[3]], unassignedSources: ['chat'] }) };
    const assistant = new LocalPlanAssistant(model);
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'GitHub login', asset: { fields: { password: ref } }, questions: [], unassignedSources: [] });
    expect(JSON.stringify(result)).not.toContain('synthetic-123');
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(assistant.confirm(result, [source]).asset.secret.password).toBe('synthetic-123');
  });
  it('keeps one exact quoted value when the model cannot classify its field', async () => {
    const source = parseLocalTextSource('chat', 'Hey create a plan called "GitHub login" for my password, this is the value "synthetic-123"');
    let modelCalls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { modelCalls++; return { questions: [localPlanQuestions[3]], unassignedSources: [] }; } });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'GitHub login', asset: { type: 'PLAIN-TEXT', name: 'GitHub login', fields: { text: quotedLocalValueSpans(source)[0] } }, questions: [], unassignedSources: [] });
    expect(JSON.stringify(result)).not.toContain('synthetic-123');
    expect(modelCalls).toBe(1);
  });
  it('keeps each pasted assignment available as its own plain-text asset', async () => {
    const block = `export APP_ENV=development\nAPI_URL="https://api.example.test"\nDATABASE_USER=importer_test\nDATABASE_PASSWORD='synthetic-db-password-009'\nFEATURE_FLAGS=import,review,"push-disabled"`;
    const pasted = parseLocalTextSource('chat', `I want to create a plan called "Inehriti credentiasl" this are the values: ${block}`);
    let modelCalls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { modelCalls++; return { questions: [localPlanQuestions[3]], unassignedSources: [] }; } });
    const result = await assistant.suggest([pasted], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'Inehriti credentiasl', assets: Array(5).fill({ type: 'PLAIN-TEXT' }), questions: [], unassignedSources: [] });
    expect(JSON.stringify(result)).not.toContain('synthetic-db-password-009');
    expect(modelCalls).toBe(1);
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(assistant.confirm(result, [pasted]).assets.map((asset) => asset.secret.text)).toEqual([
      'development', 'https://api.example.test', 'importer_test', 'synthetic-db-password-009', 'import,review,"push-disabled"',
    ]);
    const trailing = parseLocalTextSource('trailing', `I want to create a plan called "Inehriti credentiasl" this are the values: ${block}\n`);
    const withTrailing = await assistant.suggest([trailing], null, new AbortController().signal);
    if (!('asset' in withTrailing)) throw new Error('Expected a draft');
    expect(assistant.confirm(withTrailing, [trailing]).assets.map((asset) => asset.secret.text)).toEqual([
      'development', 'https://api.example.test', 'importer_test', 'synthetic-db-password-009', 'import,review,"push-disabled"',
    ]);
  });
  it('splits a pasted multi-service credentials block into plain-text assets', async () => {
    const text = `# Database\nDATABASE_URL=postgresql://app:synthetic-db-password@db.example.test:5432/app\nPOSTGRES_PASSWORD=synthetic-db-password\n\n# AWS\nAWS_ACCESS_KEY_ID=AKIAEXAMPLE000000000\nAWS_SECRET_ACCESS_KEY=synthetic-aws-secret\n\n# Redis\nREDIS_URL=redis://default:synthetic-redis-password@redis.example.test:6379`;
    const source = { id: 'chat', kind: 'message' as const, text };
    let modelCalls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { modelCalls++; return { questions: [localPlanQuestions[3]], unassignedSources: [] }; } });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'Protected entries', assets: Array(5).fill({ type: 'PLAIN-TEXT' }), questions: [], unassignedSources: [] });
    expect(JSON.stringify(result)).not.toContain('synthetic-db-password');
    expect(modelCalls).toBe(1);
    if (!('asset' in result)) throw new Error('Expected a draft');
    const confirmed = assistant.confirm(result, [source]);
    expect(confirmed.assets.map((asset) => asset.secret.text)).toEqual([
      'postgresql://app:synthetic-db-password@db.example.test:5432/app', 'synthetic-db-password',
      'AKIAEXAMPLE000000000', 'synthetic-aws-secret', 'redis://default:synthetic-redis-password@redis.example.test:6379',
    ]);
  });
  it('separates independent env secrets while honoring an explicit plan title', async () => {
    const text = 'Plan title: Operations recovery\nPlan description: Restore service access\nAssets: Database, Redis, application, OpenAI, Stripe\n'
      + 'NODE_ENV=production\nPORT=3000\nDATABASE_URL=postgresql://app:synthetic-db@db.example.test:5432/app\n'
      + 'REDIS_URL=redis://default:synthetic-redis@redis.example.test:6379\nJWT_SECRET=synthetic-jwt\nCOOKIE_SECRET=synthetic-cookie\n'
      + 'OPENAI_API_KEY=synthetic-openai\nSTRIPE_SECRET_KEY=synthetic-stripe\nSTRIPE_WEBHOOK_SECRET=synthetic-webhook';
    const source = { id: 'chat', kind: 'message' as const, text };
    let calls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { calls++; return { questions: [localPlanQuestions[3]], unassignedSources: [] }; } });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(result.title).toBe('Operations recovery');
    expect(result.assets?.map((asset) => asset.name)).toEqual([
      'Node Env', 'Port', 'Database Url', 'Redis Url', 'Jwt Secret', 'Cookie Secret', 'Openai Api Key', 'Stripe Secret Key', 'Stripe Webhook Secret',
    ]);
    expect(calls).toBe(1);
    expect(JSON.stringify(result)).not.toContain('synthetic-db');
    const values = assistant.confirm(result, [source]).assets.map((asset) => asset.secret.text);
    expect(values).toHaveLength(9);
    expect(values[0]).toBe('production');
    expect(values[5]).toBe('synthetic-cookie');
  });
  it('keeps a model-recognized account field and defaults the remaining entry to plain text', async () => {
    const source = { id: 'chat', kind: 'message' as const, text: 'Plan name: Team access\nUSERNAME=synthetic-user\nCUSTOM_VALUE=synthetic-custom' };
    const start = source.text.indexOf('synthetic-user');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ title: 'Generic plan', asset: {
      type: 'USER-PSWD', name: 'Team account', fields: { username: { sourceId: source.id, start, end: start + 'synthetic-user'.length } },
    }, questions: [], unassignedSources: [] }) });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.title).toBe('Team access');
    expect(draft.assets?.map((asset) => asset.type)).toEqual(['USER-PSWD', 'PLAIN-TEXT']);
    expect(assistant.confirm(draft, [source]).assets.map((asset) => asset.secret)).toEqual([
      { username: 'synthetic-user' }, { text: 'synthetic-custom' },
    ]);
  });
  it('uses a compact model classification for each entry and validates its catalog field', async () => {
    const source = { id: 'chat', kind: 'message' as const, text: 'Plan title: Service access\nOPENAI_API_KEY="synthetic-key"\nCUSTOM_VALUE=synthetic-custom' };
    const assistant = new LocalPlanAssistant({ infer: async ({ entryLabels }) => {
      expect(entryLabels).toEqual(['OPENAI_API_KEY', 'CUSTOM_VALUE']);
      return { entryTypes: [{ type: 'API-KEY', field: 'apiKey', name: 'OpenAI service key' },
        { type: 'USER-PSWD', field: 'password', name: 'synthetic-custom' }] };
    } });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.assets?.map(({ type }) => type)).toEqual(['API-KEY', 'PLAIN-TEXT']);
    expect(draft.assets?.map(({ name }) => name)).toEqual(['OpenAI service key', 'Custom Value']);
    expect(assistant.confirm(draft, [source]).assets.map(({ secret }) => secret)).toEqual([
      { apiKey: 'synthetic-key' }, { text: 'synthetic-custom' },
    ]);
  });
  it('keeps explicitly listed asset names ahead of model-generated names', async () => {
    const source = { id: 'chat', kind: 'message' as const, text: 'Plan title: Recovery collection\nAssets: Primary database, Session cache\nDATABASE_URL=synthetic-database\nREDIS_URL=synthetic-cache' };
    const assistant = new LocalPlanAssistant({ infer: async () => ({ entryTypes: [
      { type: 'PLAIN-TEXT', field: 'text', name: 'Database URL' }, { type: 'PLAIN-TEXT', field: 'text', name: 'Redis URL' },
    ] }) });
    const draft = await assistant.suggest([source], null, new AbortController().signal);
    if (!('asset' in draft)) throw new Error('Expected a draft');
    expect(draft.title).toBe('Recovery collection');
    expect(draft.assets?.map(({ name }) => name)).toEqual(['Primary database', 'Session cache']);
  });
  it('keeps two OAuth entries distinct when the model cannot map them', async () => {
    const values = 'MICROSOFT_OAUTH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\nMICROSOFT_OAUTH_CLIENT_SECRET=synthetic-client-secret .';
    const source = { id: 'chat', kind: 'message' as const, text: `Microsft oauth credetials: These are the credentials for oAuth for inheriti app\n\n${values}` };
    let calls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { calls++; return { questions: [localPlanQuestions[2]], unassignedSources: [] }; } });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ title: 'Protected entries', assets: Array(2).fill({ type: 'PLAIN-TEXT' }), questions: [] });
    expect(calls).toBe(1);
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(assistant.confirm(result, [source]).assets.map((asset) => asset.secret.text)).toEqual([
      'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'synthetic-client-secret .',
    ]);
  });
  it('uses plain text when a labeled secret would otherwise trigger the same field question', async () => {
    const source = parseLocalTextSource('chat', 'Credential: "synthetic-value"');
    const assistant = new LocalPlanAssistant({ infer: async () => ({ questions: [localPlanQuestions[3]], unassignedSources: [] }) });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ asset: { type: 'PLAIN-TEXT' }, questions: [] });
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(assistant.confirm(result, [source]).asset.secret.text).toBe('synthetic-value');
  });
  it('uses plain text for a single unknown env variable when the model cannot map it', async () => {
    const source = { id: 'chat', kind: 'message' as const, text: 'AWS_SECRET_ACCESS_KEY=synthetic-aws-secret' };
    const assistant = new LocalPlanAssistant({ infer: async () => ({ questions: [localPlanQuestions[3]], unassignedSources: [] }) });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ asset: { type: 'PLAIN-TEXT' }, questions: [] });
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(assistant.confirm(result, [source]).asset.secret.text).toBe('synthetic-aws-secret');
  });
  it('does not classify unrelated prose with assignment lines as a pasted env block', async () => {
    const source = parseLocalTextSource('chat', 'Create a plan called "Notes". Here are two examples:\nFOO=bar\nBAZ=qux\nThese are examples, not the asset value.');
    let modelCalls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { modelCalls++; return { title: 'Notes', useEntries: false, entryTypes: [
      { type: 'PLAIN-TEXT', field: 'text', name: 'Foo' }, { type: 'PLAIN-TEXT', field: 'text', name: 'Baz' },
    ] }; } });
    expect(await assistant.suggest([source], null, new AbortController().signal)).toEqual({ questions: [localPlanQuestions[3]], unassignedSources: ['chat'] });
    expect(modelCalls).toBe(1);
  });
  it('keeps one exact value when the model duplicates its reference', async () => {
    const source = parseLocalTextSource('chat', 'Hey create a plan called "GitHub login" for my password, this is the value "synthetic-123"');
    const ref = quotedLocalValueSpans(source)[0]!;
    const assistant = new LocalPlanAssistant({ infer: async () => ({ title: 'GitHub login', asset: { type: 'USER-PSWD', name: 'GitHub login', fields: { username: ref, password: ref } }, questions: [localPlanQuestions[0]], unassignedSources: [] }) });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ asset: { type: 'PLAIN-TEXT', fields: { text: ref } }, questions: [] });
    if (!('asset' in result)) throw new Error('Expected a draft');
    expect(Object.keys(result.asset.fields)).toEqual(['text']);
  });
  it('does not treat a password manager API key as a password', async () => {
    const source = parseLocalTextSource('chat', 'Create a plan called "Vault" for my password manager. apiKey: "synthetic-key"; this is the value.');
    let modelCalls = 0;
    const assistant = new LocalPlanAssistant({ infer: async () => { modelCalls++; return { questions: [localPlanQuestions[3]], unassignedSources: [] }; } });
    const result = await assistant.suggest([source], null, new AbortController().signal);
    expect(result).toMatchObject({ asset: { type: 'PLAIN-TEXT' }, questions: [] });
    expect(modelCalls).toBe(1);
  });
  it('asks for the value when both labels are already explicit', async () => {
    const source = parseLocalTextSource('first', 'Crea un plan llamado Demo para un asset llamado GitHub personal.');
    const model = { infer: async () => ({ questions: [localPlanQuestions[0], localPlanQuestions[2]], unassignedSources: [] }) };
    expect(await new LocalPlanAssistant(model).suggest([source], null, new AbortController().signal)).toEqual({ questions: [localPlanQuestions[4]], unassignedSources: [] });
  });
  it('binds a quoted value with an unknown language label and protects metadata', () => {
    const source = parseLocalTextSource('dutch', 'Wachtwoord: "waarde,met;tekens"');
    const spans = quotedLocalValueSpans(source);
    expect(spans).toHaveLength(1);
    expect(quotedLocalValueSpans(parseLocalTextSource('arabic', 'كلمة_المرور: "synthetic-value"'))).toHaveLength(1);
    expect(quotedLocalValueSpans(parseLocalTextSource('japanese', 'パスワード: "synthetic-value"'))).toHaveLength(1);
    if (source.kind !== 'message') throw new Error('expected message');
    expect(source.text.slice(spans[0]!.start, spans[0]!.end)).toBe('waarde,met;tekens');
    const draft = { title: 'Mijn plan', asset: { type: 'USER-PSWD', name: 'Account', fields: { password: spans[0] } }, questions: [], unassignedSources: [] };
    expect(validateLocalPlanDraft(draft, [source]).title).toBe('Mijn plan');
    expect(() => validateLocalPlanDraft({ ...draft, title: 'waarde,met;tekens' }, [source])).toThrow('Secret in plan metadata');
    expect(() => validateLocalPlanDraft({ ...draft, asset: { ...draft.asset, fields: { username: spans[0], password: spans[0] } } }, [source])).toThrow('Duplicate source reference');
  });
  it('keeps explicitly labeled public metadata outside secret candidates', () => {
    const source = parseLocalTextSource('chat', 'title: "Vacation"\npassword: "example-secret"');
    const spans = quotedLocalValueSpans(source);
    expect(spans).toHaveLength(1);
    if (source.kind !== 'message') throw new Error('expected message');
    const draft = { title: 'Vacation', asset: { type: 'USER-PSWD', name: 'Travel login', fields: { password: spans[0] } }, questions: [], unassignedSources: [] };
    expect(validateLocalPlanDraft(draft, [source]).title).toBe('Vacation');
  });
  it('does not report a quoted plan label as an omitted asset value', () => {
    const source = parseLocalTextSource('chat', 'plan: "Vacation"\npassword: "example-secret"');
    const spans = quotedLocalValueSpans(source);
    expect(spans).toHaveLength(1);
    const draft = { title: 'Vacation', asset: { type: 'USER-PSWD', name: 'Travel login', fields: { password: spans[0] } }, questions: [localPlanQuestions[3]], unassignedSources: ['chat'] };
    expect(validateLocalPlanDraft(draft, [source])).toMatchObject({ questions: [], unassignedSources: [] });
  });
  it('keeps omissions visible when a structured field encloses other quoted values', () => {
    const source = parseLocalTextSource('chat', 'password: "one"; recoveryCode: "two"');
    const draft = { title: 'Account', asset: { type: 'USER-PSWD', name: 'Login', fields: { password: { sourceId: 'chat', start: 0, end: source.kind === 'message' ? source.text.length : 0 } } }, questions: [], unassignedSources: [] };
    expect(validateLocalPlanDraft(draft, [source]).unassignedSources).toEqual(['chat']);
  });
  it('keeps a value after duplicate model references and accepts a precise follow-up', async () => {
    const first = parseLocalTextSource('dutch', 'Wachtwoord: "synthetic-value"');
    const second = parseLocalTextSource('follow-up', 'password: "synthetic-value"');
    const firstRef = quotedLocalValueSpans(first)[0]!;
    const secondRef = quotedLocalValueSpans(second)[0]!;
    const model = { infer: async ({ sources }: { sources: readonly { id: string }[] }) => ({ title: 'Access', asset: { type: 'USER-PSWD', name: 'Account', fields: sources.length === 1
      ? { username: firstRef, password: firstRef } : { password: secondRef } }, questions: [], unassignedSources: [] }) };
    expect(await new LocalPlanAssistant(model).suggest([first], null, new AbortController().signal)).toMatchObject({
      asset: { type: 'PLAIN-TEXT', fields: { text: firstRef } }, questions: [], unassignedSources: [],
    });
    const corrected = await new LocalPlanAssistant(model).suggest([first, second], null, new AbortController().signal);
    expect(corrected).toMatchObject({ asset: { fields: { password: secondRef } }, unassignedSources: ['dutch'] });
  });
  it('allows a catalog-valid selected type even when source detection suggests another type', async () => {
    const source = parseLocalTextSource('chat', 'password: "synthetic-value"');
    const assistant = new LocalPlanAssistant({ infer: async ({ allowedAssets }) => {
      expect(allowedAssets.map(({ id }) => id)).toEqual(['PLAIN-TEXT']);
      return { questions: [localPlanQuestions[3]], unassignedSources: ['chat'] };
    } });
    await expect(assistant.suggest([source], null, new AbortController().signal, 'PLAIN-TEXT'))
      .resolves.toMatchObject({ questions: [localPlanQuestions[3]] });
  });
});
