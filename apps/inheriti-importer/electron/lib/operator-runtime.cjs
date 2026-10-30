const { app } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ProtectedOperatorSessionStore } = require('./operator-session-store.cjs');

class OperatorRuntime {
  constructor({ environment, apiOrigin, issuer, loadCore = () => import('@safetech/inheriti-elements-core/node') }) {
    this.environment = environment;
    this.apiOrigin = apiOrigin;
    this.issuer = issuer;
    this.loadCore = loadCore;
    this.accounts = [];
    this.activeSubject = undefined;
    this.generation = 0;
    this.revision = 0;
    this.pending = undefined;
    this.stores = new Map();
    this.cores = new Map();
    this.mutation = Promise.resolve();
  }

  async initialize() {
    await app.whenReady();
    this.sdk = await this.loadCore();
    this.authority = this.sdk.INTEGRATION_AUTHORITY;
    this.sessionKind = this.authority === 'business' ? 'business' : 'safeid-oidc-business';
    this.sessionEnvironment = this.environment;
    this.clientId = this.sdk.BUSINESS_INTERACTIVE_CLIENT_ID;
    this.audience = 'inheriti-integrations-api';
    this.indexFile = path.join(app.getPath('userData'), `operator-accounts-${this.environment}.json`);
    try {
      const index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (index.apiOrigin === this.apiOrigin && index.issuer === this.issuer &&
        index.authority === this.authority && index.clientId === this.clientId &&
        index.audience === this.audience && Array.isArray(index.subjects)) {
        this.accounts = index.subjects.filter((subject) => typeof subject === 'string' && subject);
        this.activeSubject = this.accounts.includes(index.activeSubject) ? index.activeSubject : undefined;
      }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    this.rebuild();
    return this.descriptor();
  }

  store(subject) {
    if (!this.stores.has(subject) || !this.stores.get(subject).current())
      this.stores.set(subject, new ProtectedOperatorSessionStore(this.sessionEnvironment, this.apiOrigin, this.issuer, subject,
        this.sessionKind, this.clientId, this.audience));
    return this.stores.get(subject);
  }

  mutate(action) {
    const result = this.mutation.then(action, action);
    this.mutation = result.catch(() => {});
    return result;
  }

  core(sessions, configuration = this.configuration()) {
    return this.sdk.createNodeIntegrationCore({
      apiUrl: new URL('/integrations/', this.apiOrigin).toString(), business: true,
      environment: this.environment, liveConfirmation: this.environment, masterKey: {},
      configuration,
      sessions,
    });
  }

  accountCore(subject) {
    const store = this.store(subject);
    const cached = this.cores.get(subject);
    if (cached?.store === store) return cached.core;
    const core = this.core(store);
    this.cores.set(subject, { store, core });
    return core;
  }

  configuration() { return { issuer: this.issuer, clientId: this.clientId,
    audience: this.audience, environment: this.environment,
    redirectUri: 'http://127.0.0.1/oauth/callback', scopes: ['openid', 'profile'] }; }

  rebuild() { this.activeCore = this.activeSubject ? this.accountCore(this.activeSubject) : undefined; }
  descriptor() { return { accounts: this.accounts.map((subject) => ({ subject })), activeSubject: this.activeSubject }; }
  list() { return this.descriptor(); }
  capture() { return { subject: this.activeSubject, generation: this.generation }; }
  isCurrent(capture) { return capture.generation === this.generation && capture.subject === this.activeSubject; }

  async getAccessToken(capture = this.capture()) {
    if (!capture.subject || !this.isCurrent(capture)) return undefined;
    const token = await this.activeCore.auth.getAccessToken();
    return this.isCurrent(capture) ? token : undefined;
  }

  async getAccountAccessToken(subject) {
    if (!this.accounts.includes(subject)) return undefined;
    const store = this.store(subject);
    const current = () => this.accounts.includes(subject) && this.stores.get(subject) === store && store.current();
    try {
      const token = await this.accountCore(subject).auth.getAccessToken();
      return current() ? token : undefined;
    } catch (error) {
      if (!current() || !await store.load()) return undefined;
      throw error;
    }
  }

  async sessionDescriptor() {
    const capture = this.capture();
    if (!capture.subject) return null;
    const store = this.store(capture.subject);
    try {
      if (!await this.getAccessToken(capture)) return null;
      const session = await store.load();
      if (!this.isCurrent(capture) || !session) return null;
      const sessionId = session.kind === 'business' ? session.familyId : session.principal.sessionId;
      if (typeof sessionId !== 'string' || !sessionId) return null;
      return { sessionFamilyId: sessionId, subject: session.principal.subject,
        expiresAt: new Date(session.kind === 'business' ? session.sessionExpiresAt : session.expiresAt).toISOString() };
    } catch (error) {
      if (!this.isCurrent(capture) || !await store.load()) return null;
      throw error;
    }
  }

  async login(openBrowser, signal, options = {}) {
    if (this.pending) throw new Error('operator_authorization_pending');
    const pending = this.authorize(openBrowser, signal, options);
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = undefined; }
  }

  async authorize(openBrowser, signal, options) {
    const revision = this.revision;
    const sessions = new this.sdk.MemoryOperatorSessionStore();
    const configuration = this.configuration();
    const core = this.core(sessions, configuration);
    const resetSafeId = options.activate === false && this.authority === 'business' && this.accounts.length > 0;
    const callback = await waitForCallback(async (redirectUri) => {
      configuration.redirectUri = redirectUri;
      const started = await core.auth.beginAuthorizationCode();
      const url = new URL(started.authorizationUrl);
      url.searchParams.set('prompt', 'login');
      if (!resetSafeId) return { authorizationUrl: url.toString() };
      const discovery = await fetch(`${this.issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      });
      if (!discovery.ok) throw new Error('safeid_logout_unavailable');
      const provider = await discovery.json();
      if (provider.issuer !== this.issuer || !provider.end_session_endpoint ||
        new URL(provider.end_session_endpoint).origin !== new URL(this.issuer).origin)
        throw new Error('safeid_logout_unavailable');
      const logout = new URL(provider.end_session_endpoint);
      const logoutState = url.searchParams.get('state');
      if (!logoutState) throw new Error('safeid_logout_unavailable');
      logout.searchParams.set('client_id', this.clientId);
      logout.searchParams.set('post_logout_redirect_uri', redirectUri);
      logout.searchParams.set('state', logoutState);
      return { authorizationUrl: url.toString(), logoutUrl: logout.toString() };
    }, openBrowser, signal);
    signal?.throwIfAborted();
    await core.auth.completeAuthorizationCode(callback);
    signal?.throwIfAborted();
    await core.listOrganizations();
    signal?.throwIfAborted();
    const session = await sessions.load();
    if (!session || session.kind !== this.sessionKind || session.principal?.issuer !== this.issuer || !session.principal.subject ||
      session.principal.environment !== this.sessionEnvironment || session.principal.authorizedParty !== this.clientId ||
      session.principal.audience !== this.audience)
      throw new Error('operator_account_invalid');
    if (revision !== this.revision) throw new Error('operator_context_changed');
    return this.mutate(async () => {
      if (revision !== this.revision) throw new Error('operator_context_changed');
      const subject = session.principal.subject;
      const existing = this.accounts.includes(subject);
      if (existing && options.activate === false) {
        await core.auth.clear().catch(() => {});
        throw new Error('operator_account_already_enrolled');
      }
      let store = this.store(subject);
      const previous = await store.load();
      if (revision !== this.revision) throw new Error('operator_context_changed');
      let expectedRevision = revision;
      if (existing) {
        store.retire();
        this.stores.delete(subject);
        this.cores.delete(subject);
        store = this.store(subject);
        ++this.revision;
        expectedRevision = this.revision;
        if (this.activeSubject === subject) {
          this.activeCore = this.accountCore(subject);
          ++this.generation;
        }
      }
      try {
        await store.save(session);
        if (expectedRevision !== this.revision) throw new Error('operator_context_changed');
        const accounts = existing ? this.accounts : this.accounts.concat(subject);
        const activeSubject = options.activate === false ? this.activeSubject : subject;
        const enrolledCore = this.core(store);
        const activeCore = activeSubject === subject ? enrolledCore : this.activeCore;
        this.persist(accounts, activeSubject);
        this.accounts = accounts;
        this.activeSubject = activeSubject;
        this.activeCore = activeCore;
        this.cores.set(subject, { store, core: enrolledCore });
        ++this.revision;
        if (activeSubject === subject) ++this.generation;
        return this.descriptor();
      } catch (error) {
        if (previous) await store.save(previous);
        else { await store.clear(); this.stores.delete(subject); }
        if (this.activeSubject === subject && !previous) this.rebuild();
        throw error;
      }
    });
  }

  activate(subject) {
    if (!this.accounts.includes(subject)) throw new Error('operator_account_not_found');
    const activeCore = this.accountCore(subject);
    this.persist(this.accounts, subject);
    this.activeSubject = subject;
    this.activeCore = activeCore;
    ++this.revision;
    ++this.generation;
    return this.descriptor();
  }

  async remove(subject) {
    return this.mutate(async () => {
      if (!this.accounts.includes(subject)) return { remoteRevocationFailed: false };
      const store = this.store(subject);
      const accounts = this.accounts.filter((candidate) => candidate !== subject);
      const wasActive = this.activeSubject === subject;
      const activeSubject = wasActive ? undefined : this.activeSubject;
      const activeCore = activeSubject ? this.accountCore(activeSubject) : undefined;
      this.persist(accounts, activeSubject);
      this.accounts = accounts;
      this.activeSubject = activeSubject;
      this.activeCore = activeCore;
      ++this.revision;
      if (wasActive) ++this.generation;
      let remoteRevocationFailed = false;
      try {
        if (await store.load()) await this.accountCore(subject).auth.clear();
      } catch { remoteRevocationFailed = true; }
      await store.clear();
      this.stores.delete(subject);
      this.cores.delete(subject);
      return { remoteRevocationFailed };
    });
  }

  async logoutAll() {
    ++this.revision;
    ++this.generation;
    let remoteRevocationFailed = false;
    for (const subject of Array.from(this.accounts)) {
      const result = await this.remove(subject);
      remoteRevocationFailed ||= result.remoteRevocationFailed;
    }
    return { remoteRevocationFailed };
  }

  persist(accounts = this.accounts, activeSubject = this.activeSubject) {
    fs.mkdirSync(path.dirname(this.indexFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.indexFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ apiOrigin: this.apiOrigin, issuer: this.issuer,
      authority: this.authority, clientId: this.clientId, audience: this.audience,
      subjects: accounts, activeSubject }), { mode: 0o600 });
    fs.renameSync(temporary, this.indexFile);
  }
}

function waitForCallback(buildUrl, openBrowser, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('operator_authorization_canceled')); return; }
    let settled = false;
    let redirectUri;
    let canceledCloseTimer;
    let authorizationUrl;
    let awaitingLogout = false;
    let logoutState;
    const server = createServer((request, response) => {
      if (settled) {
        if (canceledCloseTimer) clearTimeout(canceledCloseTimer);
        response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
          .end('Sign-in was cancelled. Return to Inheriti Importer.');
        server.close();
        return;
      }
      let url;
      try { url = new URL(request.url || '/', redirectUri); }
      catch { response.writeHead(400).end(); return; }
      if (url.pathname !== '/oauth/callback') { response.writeHead(404).end(); return; }
      if (url.searchParams.has('error')) {
        response.writeHead(400).end();
        finish(new Error(url.searchParams.get('error')));
        return;
      }
      if (awaitingLogout) {
        if (url.searchParams.has('code') || url.searchParams.get('state') !== logoutState) {
          response.writeHead(400).end();
          return;
        }
        awaitingLogout = false;
        response.writeHead(302, { location: authorizationUrl, 'cache-control': 'no-store' }).end();
        return;
      }
      if (!url.searchParams.has('code') || !url.searchParams.has('state')) {
        response.writeHead(400).end(); finish(new Error(url.searchParams.get('error') || 'operator_callback_invalid')); return;
      }
      response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Browser step complete. Return to Inheriti Importer.');
      finish(undefined, url.toString());
    });
    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      server.close();
      if (error) reject(error); else resolve(url);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      canceledCloseTimer = setTimeout(() => server.close(), 300_000);
      canceledCloseTimer.unref();
      reject(new Error('operator_authorization_canceled'));
    };
    const timeout = setTimeout(() => finish(new Error('operator_authorization_timeout')), 300_000);
    signal?.addEventListener('abort', cancel, { once: true });
    server.once('error', finish);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      Promise.resolve().then(() => {
        if (settled) return;
        return buildUrl(redirectUri);
      }).then((result) => {
        if (settled || !result) return;
        const { authorizationUrl: nextAuthorizationUrl, logoutUrl } = result;
        authorizationUrl = nextAuthorizationUrl;
        awaitingLogout = Boolean(logoutUrl);
        logoutState = new URL(authorizationUrl).searchParams.get('state');
        return openBrowser(logoutUrl || authorizationUrl);
      }).catch(finish);
    });
  });
}

module.exports = { OperatorRuntime };
