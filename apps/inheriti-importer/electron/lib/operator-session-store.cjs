const { app, safeStorage } = require('electron');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const epochs = new Map();

class ProtectedOperatorSessionStore {
  constructor(environment, apiOrigin, issuer, subject) {
    if (![environment, apiOrigin, issuer, subject].every((value) => typeof value === 'string' && value))
      throw new Error('operator_account_invalid');
    this.issuer = issuer;
    this.subject = subject;
    this.key = createHash('sha256').update(JSON.stringify([environment, apiOrigin, issuer, subject])).digest('hex');
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
    return session && typeof session === 'object' && session.kind === 'business' &&
      session.principal?.issuer === this.issuer && session.principal.subject === this.subject &&
      typeof session.familyId === 'string' && !!session.familyId &&
      typeof session.accessToken === 'string' && !!session.accessToken &&
      typeof session.refreshToken === 'string' && !!session.refreshToken &&
      session.tokenType === 'Bearer' && Number.isFinite(session.expiresAt) &&
      Number.isFinite(session.sessionExpiresAt);
  }
}

module.exports = { ProtectedOperatorSessionStore };
