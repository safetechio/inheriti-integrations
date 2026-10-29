const { app, safeStorage } = require('electron');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const epochs = new Map();

class ProtectedOperatorSessionStore {
  constructor(environment, apiOrigin, issuer, subject, authority = 'business', clientId = '', audience = 'inheriti-integrations-api') {
    if (![environment, apiOrigin, issuer, subject].every((value) => typeof value === 'string' && value))
      throw new Error('operator_account_invalid');
    this.issuer = issuer;
    this.apiOrigin = apiOrigin;
    this.environment = environment;
    this.subject = subject;
    this.authority = authority;
    this.clientId = clientId;
    this.audience = audience;
    this.key = createHash('sha256').update(JSON.stringify([environment, apiOrigin, issuer, subject, authority, clientId, audience])).digest('hex');
    this.epoch = epochs.get(this.key) || 0;
    this.retired = false;
    this.memory = undefined;
  }

  async ready() {
    await app.whenReady();
    const file = path.join(app.getPath('userData'), `operator-session-${this.key}`);
    const available = safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
    return { file, available };
  }

  current() { return !this.retired && this.epoch === (epochs.get(this.key) || 0); }

  retire() {
    if (!this.current()) return;
    epochs.set(this.key, this.epoch + 1);
    this.retired = true;
  }

  async load() {
    if (!this.current()) return undefined;
    const { file, available } = await this.ready();
    if (!this.current()) return undefined;
    if (!available) return this.memory;
    if (!fs.existsSync(file)) return undefined;
    try {
      const encrypted = fs.readFileSync(file);
      const session = JSON.parse(safeStorage.decryptString(encrypted));
      if (!this.valid(session)) return undefined;
      return session;
    } catch { return undefined; }
  }

  async save(session) {
    if (!this.current()) throw new Error('operator_session_retired');
    if (!this.valid(session)) throw new Error('Invalid operator session');
    const { file, available } = await this.ready();
    if (!this.current()) throw new Error('operator_session_retired');
    if (!available) {
      if (fs.existsSync(file)) throw new Error('protected_storage_unavailable');
      this.memory = session;
      return;
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(session));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 });
      if (!this.current()) throw new Error('operator_session_retired');
      fs.renameSync(temporary, file);
      this.memory = undefined;
    } finally { fs.rmSync(temporary, { force: true }); }
  }

  async clear() {
    if (!this.current()) return;
    const { file, available } = await this.ready();
    if (!this.current()) return;
    fs.rmSync(file, { force: true });
    this.memory = undefined;
    this.retire();
  }

  valid(session) {
    return session && typeof session === 'object' && session.kind === this.authority &&
      session.principal?.issuer === this.issuer && session.principal.subject === this.subject &&
      session.principal.environment === this.environment &&
      session.principal.authorizedParty === this.clientId &&
      (session.principal.audience === this.audience ||
        (Array.isArray(session.principal.audience) && session.principal.audience.includes(this.audience))) &&
      (this.authority !== 'safeid-oidc-business' ||
        (session.businessApiUrl === new URL('/integrations/', this.apiOrigin).toString() &&
          session.audience === this.audience && session.clientId === this.clientId &&
          session.environment === this.environment && session.issuer === this.issuer.replace(/\/+$/, ''))) &&
      (this.authority !== 'business' || (typeof session.familyId === 'string' && !!session.familyId)) &&
      typeof session.accessToken === 'string' && !!session.accessToken &&
      typeof session.refreshToken === 'string' && !!session.refreshToken &&
      session.tokenType === 'Bearer' && Number.isFinite(session.expiresAt) &&
      (this.authority !== 'business' || Number.isFinite(session.sessionExpiresAt));
  }
}

module.exports = { ProtectedOperatorSessionStore };
