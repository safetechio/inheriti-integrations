import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import type { AutomationConnection, AutomationGrant, AutomationMember, AutomationPlan, AutomationProvider, AutomationSetupOperations, AutomationTrust } from './automation-setup.js';

export type AutomationSetupResult = { action: string; id?: string };
export type LocalAutomationSetupBrowserOptions = {
  operations: AutomationSetupOperations;
  open: (url: string) => void;
  signal?: AbortSignal;
  organizationName?: string;
  initialPlanId?: string;
  initialConnectionId?: string;
  proofOnly?: boolean;
};

export function runLocalAutomationProofBrowser(options: Omit<LocalAutomationSetupBrowserOptions, 'initialPlanId' | 'initialConnectionId' | 'proofOnly'> & { connectionId: string }): Promise<AutomationSetupResult> {
  return runLocalAutomationSetupBrowser({ ...options, initialConnectionId: options.connectionId, proofOnly: true });
}
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const option = (id: string, label: string, selected = '') => `<option value="${escape(id)}"${id === selected ? ' selected' : ''}>${escape(label)}</option>`;
const fieldHelp: Record<string, [string, string]> = {
  name: ['e.g. Production CI', 'A name your team will recognize.'],
  repositoryName: ['e.g. acme/deploy', 'GitHub owner and repository allowed to run this automation.'],
  trustEnvironment: ['e.g. production', 'The provider environment bound to this identity.'],
  workflow: ['e.g. deploy.yml', 'The workflow file allowed to request proof.'],
  audienceBase: ['e.g. https://example.com/workload', 'The connection ID is appended automatically.'],
  serviceAccountSubject: ['e.g. 123456789012345678901', 'Use the numeric service account unique ID, not its email.'],
  roleArn: ['e.g. arn:aws:iam::123456789012:role/DeployRole', 'The IAM role this automation assumes.'],
  keyId: ['e.g. runner-key-1', 'Identifier of the runner public key.'],
  publicKey: ['e.g. base64 public key', 'Share only the public key; keep the private key on the runner.'],
  runnerSubject: ['e.g. deploy-runner', 'Identity name asserted by the runner.'],
  proof: ['Paste the signed identity proof', 'Provide a fresh proof from the configured provider.'],
  connectionId: ['e.g. connection UUID', 'Ask an administrator for the verified connection ID.'],
};
const field = (name: string, label: string, value = '', type = 'text') => `<label>${escape(label)}<input name="${escape(name)}" type="${type}" value="${escape(value)}" placeholder="${escape(fieldHelp[name]?.[0])}" maxlength="2048" required><small>${escape(fieldHelp[name]?.[1])}</small></label>`;
const button = (action: string, label: string) => `<button name="action" value="${action}">${label}</button>`;

export async function runLocalAutomationSetupBrowser(options: LocalAutomationSetupBrowserOptions): Promise<AutomationSetupResult> {
  if (options.signal?.aborted) throw new Error('automation_setup_canceled');
  const path = `/${randomBytes(24).toString('hex')}`;
  const csrf = randomBytes(24).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const sockets = new Set<Socket>();
  let port = 0;
  let done = false;
  let busy = false;
  let notice = '';
  let selectedPlanId = options.initialPlanId ?? '';
  let selectedConnectionId = options.initialConnectionId ?? '';
  let draftConnectionId = randomUUID();
  let pending: { action: 'disable' | 'revoke'; id: string; planId: string } | undefined;
  let connections: AutomationConnection[] = [];
  let plans: AutomationPlan[] = [];
  let members: AutomationMember[] = [];
  let grants: AutomationGrant[] = [];
  let finish!: (result?: AutomationSetupResult, error?: Error) => void;
  const result = new Promise<AutomationSetupResult>((resolve, reject) => {
    finish = (value, error) => { if (done) return; done = true; if (error) reject(error); else resolve(value!); };
  });
  const load = async () => {
    if (options.proofOnly) { connections = [await options.operations.getConnection(selectedConnectionId)]; return; }
    const results = await Promise.allSettled([options.operations.listConnections(), options.operations.listPlans(), options.operations.listMembers()]);
    connections = results[0].status === 'fulfilled' ? results[0].value : [];
    plans = results[1].status === 'fulfilled' ? results[1].value : [];
    members = results[2].status === 'fulfilled' ? results[2].value : [];
    if (results.some((item) => item.status === 'rejected')) notice = 'Some setup sections are unavailable for your account.';
    if (!selectedPlanId) selectedPlanId = plans[0]?.id ?? '';
    try { grants = selectedPlanId ? await options.operations.listGrants(selectedPlanId) : []; } catch { grants = []; notice = 'Plan grants are unavailable for your account.'; }
  };
  const page = () => {
    const connection = connections.find(({ id }) => id === selectedConnectionId);
    const planOptions = plans.map((plan) => option(plan.id, plan.title ?? plan.name ?? plan.id, selectedPlanId)).join('');
    const connectionOptions = connections.map((item) => option(item.id, `${item.name} (${item.status})`, selectedConnectionId)).join('');
    const memberOptions = members.filter((member) => (!member.status || ['ACTIVE', 'CLAIMED'].includes(member.status)) && (!member.masterKeyStatus || ['ACTIVE', 'CLAIMED'].includes(member.masterKeyStatus))).map((member) => option(member.id, `${member.firstName ?? ''} ${member.lastName ?? ''} ${member.email ?? ''}`.trim())).join('');
    const grantOptions = grants.map((grant) => option(grant.id, `${grant.id} (${grant.status})`)).join('');
    const trustFields = (method: string) => method === 'GITHUB_ACTIONS_OIDC' ? field('repositoryName', 'Repository owner/name') + field('trustEnvironment', 'GitHub environment') + field('workflow', 'Workflow')
      : method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ? field('audienceBase', 'Audience base') + field('serviceAccountSubject', 'Service account subject (numeric unique ID)')
      : method === 'AWS_IAM_ROLE' ? field('roleArn', 'Role ARN')
      : field('keyId', 'Key ID') + field('publicKey', 'Public key') + field('runnerSubject', 'Runner subject') + field('trustEnvironment', 'Runner environment');
    const forms = options.proofOnly ? `<section><h2>Verify identity</h2><p>Connection: ${escape(connection?.name ?? selectedConnectionId)}</p><p>Provider: ${escape(connection?.provider ?? '')}</p><p>Status: ${escape(connection?.status ?? '')}</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="connectionId" value="${escape(selectedConnectionId)}">${field('proof', 'Identity proof', '', 'password').replace('maxlength="2048"', 'maxlength="16384"')}${button('verify', 'Verify identity')}</form></section>` : `<section><h2>Existing connections</h2><form method="post"><input type="hidden" name="csrf" value="${csrf}"><label>Resume connection<small>Select a pending connection to finish verification, or create a new one.</small><select name="connectionId">${option('', 'Create new connection', selectedConnectionId)}${connectionOptions}</select></label>${button('select-connection', 'Continue')}</form></section>${!connection ? `<section><h2>Step 1: Create connection</h2><form method="post"><input type="hidden" name="csrf" value="${csrf}">${field('name', 'Name')}<label>Provider<small>Choose where the automation runs.</small><select name="provider" id="provider"><option value="GITHUB">GitHub Actions</option><option value="GOOGLE_CLOUD">Google Cloud</option><option value="AWS">AWS</option><option value="PORTABLE">Custom runner (Portable)</option></select></label><label>Environment<small>Use TEST while setting up; select LIVE for production.</small><select name="deploymentEnvironment"><option>TEST</option><option>LIVE</option></select></label><div id="trust-fields">${trustFields('GITHUB_ACTIONS_OIDC')}</div>${button('create', 'Create connection')}</form></section>` : ''}${connection ? `<section><h2>Step 2: Verify identity</h2><form method="post"><input type="hidden" name="csrf" value="${csrf}"><label>Connection<small>Select the connection to inspect or grant access.</small><select name="connectionId">${connectionOptions}</select></label>${button('select-connection', 'Show setup values')}</form>${connection ? `<p>Status: ${escape(connection.status)} · Provider: ${escape(connection.provider)}</p><p><strong>Connection ID:</strong> <code>${escape(connection.id)}</code></p>${connection.provider === 'GITHUB' || connection.provider === 'GOOGLE_CLOUD' ? `<p><strong>Expected audience:</strong> <code>${escape(connection.provider === 'GOOGLE_CLOUD' && connection.trust.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ? connection.trust.audience : `urn:inheriti:automation:connection:${connection.id}`)}</code></p>` : ''}<pre>${escape(JSON.stringify(connection.trust, null, 2))}</pre><p>${escape(connection.provider === 'GITHUB' ? 'Configure your GitHub Actions OIDC trust with this audience, repository, environment, and workflow. Run the workflow and paste its OIDC token as proof.' : connection.provider === 'GOOGLE_CLOUD' ? 'Configure workload identity for the listed service account subject and audience. Paste its OIDC token as proof.' : connection.provider === 'AWS' ? 'Configure the listed IAM role trust, then provide the signed identity proof from that role.' : 'Run the automation with the matching private key on your runner. Paste its signed identity proof here.')}</p>` : ''}<form method="post"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="connectionId" value="${escape(selectedConnectionId)}">${field('proof', 'Identity proof', '', 'password').replace('maxlength="2048"', 'maxlength="16384"')}${connection?.status === 'PENDING_VERIFICATION' ? button('verify', 'Verify identity') : ''}</form><form method="post"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="connectionId" value="${escape(selectedConnectionId)}"><p>Changing trust requires identity verification again and may suspend active grants.</p><label>New trust method<small>Choose the identity method this connection will use.</small><select name="method" id="change-method">${['GITHUB_ACTIONS_OIDC','GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC','AWS_IAM_ROLE','PORTABLE_SIGNED_ASSERTION'].map((method) => option(method, method, connection?.trust.method)).join('')}</select></label><div id="change-fields">${trustFields(connection?.trust.method ?? 'GITHUB_ACTIONS_OIDC')}</div>${button('change-trust', 'Change trust')}</form><form method="post"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="connectionId" value="${escape(selectedConnectionId)}">${button('disable', 'Disable connection')}</form></section>` : ''}${connection?.status === 'VERIFIED' || (!connections.length && plans.length > 0) ? `<section><h2>Plan grants</h2><form method="post"><input type="hidden" name="csrf" value="${csrf}"><label>Plan<small>Choose the protected plan this connection may access.</small><select name="planId">${planOptions}</select></label>${button('select-plan', 'Show grants')}</form><p>${grants.map((grant) => `${escape(grant.id)}: ${escape(grant.status)}`).join('<br>')}</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="planId" value="${escape(selectedPlanId)}">${connections.length ? `<label>Connection<small>Select the connection to inspect or grant access.</small><select name="connectionId">${connectionOptions}</select></label>` : field('connectionId', 'Connection ID from an administrator')}<label>Responsible member<small>This member is accountable for the grant.</small><select name="responsibleMemberId">${memberOptions}</select></label>${button('create-grant', 'Create grant')}</form><form method="post"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="planId" value="${escape(selectedPlanId)}"><label>Grant<small>Select the grant to activate, update, or revoke.</small><select name="grantId">${grantOptions}</select></label><label>Responsible member<small>This member is accountable for the grant.</small><select name="responsibleMemberId">${memberOptions}</select></label>${button('activate', 'Activate')}${button('replace-member', 'Replace member')}${button('revoke', 'Revoke')}</form></section>` : ''}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Automation setup</title><style>body{font:15px system-ui;background:#f7f8fa;color:#1d2939;max-width:900px;margin:32px auto;padding:0 20px}h1{font-size:28px}section{background:white;border:1px solid #d8dee8;border-radius:12px;padding:20px;margin:20px 0}label{display:block;margin:12px 0;font-weight:600}small{display:block;color:#667085;font-size:12px;font-weight:400;margin:3px 0 5px}input,select{display:block;width:100%;box-sizing:border-box;padding:10px;border:1px solid #bcc7d5;border-radius:6px;margin-top:5px}button{background:#174ea6;color:white;border:0;border-radius:6px;padding:10px 14px;margin:8px 8px 0 0;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f3f8;padding:12px;border-radius:6px}.notice{padding:12px;background:#edf4ff;border-radius:6px}</style></head><body><h1>${escape(options.organizationName ?? 'Business')} automation setup</h1>${notice ? `<p class="notice">${escape(notice)}</p>` : ''}${pending ? `<section><h2>Confirm ${pending.action}</h2><p>This will ${pending.action} ${escape(pending.id)}.</p><form method="post"><input type="hidden" name="csrf" value="${csrf}">${button('confirm', 'Confirm')}${button('cancel-confirmation', 'Keep it')}</form></section>` : forms}<form method="post"><input type="hidden" name="csrf" value="${csrf}">${button('done', 'Done')}</form><script nonce="${nonce}">const hints={repositoryName:['e.g. acme/deploy','GitHub owner and repository allowed to run this automation.'],trustEnvironment:['e.g. production','The provider environment bound to this identity.'],workflow:['e.g. deploy.yml','The workflow file allowed to request proof.'],audienceBase:['e.g. https://example.com/workload','The connection ID is appended automatically.'],serviceAccountSubject:['e.g. 123456789012345678901','Use the numeric service account unique ID, not its email.'],roleArn:['e.g. arn:aws:iam::123456789012:role/DeployRole','The IAM role this automation assumes.'],keyId:['e.g. runner-key-1','Identifier of the runner public key.'],publicKey:['e.g. base64 public key','Share only the public key; keep the private key on the runner.'],runnerSubject:['e.g. deploy-runner','Identity name asserted by the runner.']};const specs={GITHUB_ACTIONS_OIDC:[['repositoryName','Repository owner/name'],['trustEnvironment','GitHub environment'],['workflow','Workflow']],GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC:[['audienceBase','Audience base'],['serviceAccountSubject','Service account subject (numeric unique ID)']],AWS_IAM_ROLE:[['roleArn','Role ARN']],PORTABLE_SIGNED_ASSERTION:[['keyId','Key ID'],['publicKey','Public key'],['runnerSubject','Runner subject'],['trustEnvironment','Runner environment']]};function update(select,target){let method=select.value==='GITHUB'?'GITHUB_ACTIONS_OIDC':select.value==='GOOGLE_CLOUD'?'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC':select.value==='AWS'?'AWS_IAM_ROLE':select.value==='PORTABLE'?'PORTABLE_SIGNED_ASSERTION':select.value;target.replaceChildren(...specs[method].map(([name,label])=>{let el=document.createElement('label');el.textContent=label;let input=document.createElement('input');input.name=name;input.required=true;input.maxLength=2048;input.placeholder=hints[name]?.[0]||'';el.append(input);let help=document.createElement('small');help.textContent=hints[name]?.[1]||'';el.append(help);return el}))}let provider=document.getElementById('provider'),method=document.getElementById('change-method');provider?.addEventListener('change',()=>update(provider,document.getElementById('trust-fields')));method?.addEventListener('change',()=>update(method,document.getElementById('change-fields')));</script></body></html>`;
  };
  const trust = (data: URLSearchParams, connectionId: string): AutomationTrust => {
    const method = data.get('method') ?? ({ GITHUB: 'GITHUB_ACTIONS_OIDC', GOOGLE_CLOUD: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', AWS: 'AWS_IAM_ROLE', PORTABLE: 'PORTABLE_SIGNED_ASSERTION' } as Record<string, string>)[data.get('provider') ?? ''];
    const value = (name: string) => { const item = data.get(name)?.trim() ?? ''; if (!item || item.length > 2048) throw new Error(`Invalid ${name}`); return item; };
    if (method === 'GITHUB_ACTIONS_OIDC') return { method, repositoryName: value('repositoryName'), environment: value('trustEnvironment'), workflow: value('workflow') };
    if (method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC') return { method, audience: `${value('audienceBase').replace(/\/$/, '')}/${connectionId}`, serviceAccountSubject: value('serviceAccountSubject') };
    if (method === 'AWS_IAM_ROLE') return { method, roleArn: value('roleArn') };
    if (method === 'PORTABLE_SIGNED_ASSERTION') return { method, keyId: value('keyId'), publicKey: value('publicKey'), runnerSubject: value('runnerSubject'), environment: value('trustEnvironment') };
    throw new Error('Invalid trust method');
  };
  const server = createServer((request, response) => { void (async () => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403).end(); return; }
    if (request.url !== path) { response.writeHead(404).end(); return; }
    if (done) { response.writeHead(410).end(); return; }
    if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page()); return; }
    if (request.method !== 'POST' || request.headers.origin !== `http://127.0.0.1:${port}`) { response.writeHead(403).end(); return; }
    if (busy) { response.writeHead(409).end(); return; }
    busy = true;
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += (chunk as Buffer).length; if (size > 32_768) { response.writeHead(413).end(); return; } chunks.push(chunk as Buffer); }
      if (!(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) { response.writeHead(415).end(); return; }
      const data = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      if (data.get('csrf') !== csrf) { response.writeHead(403).end(); return; }
      const action = data.get('action') ?? '';
      if (options.proofOnly && action !== 'verify' && action !== 'done') throw new Error('Unknown action');
      const connectionId = data.get('connectionId') ?? '';
      const planId = data.get('planId') ?? selectedPlanId;
      const grantId = data.get('grantId') ?? '';
      if (action === 'done') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Done</title><p>You can close this window.</p>'); finish({ action: 'done' }); return; }
      if (action === 'select-connection') selectedConnectionId = connectionId;
      else if (action === 'select-plan') selectedPlanId = planId;
      else if (action === 'cancel-confirmation') pending = undefined;
      else if (action === 'confirm') {
        if (!pending) throw new Error('No action to confirm');
        if (pending.action === 'disable') await options.operations.disableConnection(pending.id);
        else await options.operations.revokeGrant(pending.planId, pending.id);
        notice = `${pending.action} completed`; pending = undefined;
      } else if (action === 'disable' || action === 'revoke') {
        const id = action === 'disable' ? connectionId : grantId;
        if (!id) throw new Error('Select an item');
        pending = { action, id, planId };
      } else if (action === 'create') {
        const provider = data.get('provider') as AutomationProvider;
        if (!['GITHUB', 'GOOGLE_CLOUD', 'AWS', 'PORTABLE'].includes(provider)) throw new Error('Invalid provider');
        const id = draftConnectionId;
        await options.operations.createConnection({ id, name: data.get('name')?.trim() ?? '', provider, environment: data.get('deploymentEnvironment') === 'LIVE' ? 'LIVE' : 'TEST', trust: trust(data, id) });
        draftConnectionId = randomUUID();
        selectedConnectionId = id; notice = 'Connection created. Copy the setup values and verify its identity.';
      } else if (action === 'verify') { if (!connectionId || options.proofOnly && connectionId !== selectedConnectionId) throw new Error('Select a connection'); await options.operations.verifyConnection(connectionId, data.get('proof') ?? ''); notice = 'Identity verification submitted'; if (options.proofOnly) { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Verified</title><p>Identity verification submitted. You can close this window.</p>'); finish({ action: 'verified', id: connectionId }); return; } }
      else if (action === 'change-trust') { if (!connectionId) throw new Error('Select a connection'); await options.operations.changeTrust(connectionId, trust(data, connectionId)); notice = 'Trust changed. Verify identity again.'; }
      else if (action === 'create-grant') { const id = randomUUID(); await options.operations.createGrant(planId, { id, connectionId, responsibleMemberId: data.get('responsibleMemberId') ?? '' }); notice = 'Grant created'; }
      else if (action === 'activate') { await options.operations.activateGrant(planId, grantId); notice = 'Grant activated'; }
      else if (action === 'replace-member') { await options.operations.replaceResponsibleMember(planId, grantId, data.get('responsibleMemberId') ?? ''); notice = 'Responsible member replaced'; }
      else throw new Error('Unknown action');
      await load();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page());
    } catch (error) { notice = error instanceof Error ? error.message : 'Action failed'; response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page()); }
    finally { busy = false; }
  })(); });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const abort = () => finish(undefined, new Error('automation_setup_canceled'));
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) abort();
    await Promise.race([load(), result]);
    if (done) return await result;
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    port = (server.address() as { port: number }).port;
    options.open(`http://127.0.0.1:${port}${path}`);
    return await result;
  } finally { options.signal?.removeEventListener('abort', abort); for (const socket of sockets) socket.destroy(); server.close(); }
}
