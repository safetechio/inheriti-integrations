import { app, safeStorage } from 'electron';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EditRecoveryRecord } from '@safetech/inheriti-elements-core/node';
import { trayMessages as messages } from '../../../messages.js';

export class ProtectedCheckpoint {
  private readonly file = join(app.getPath('userData'), 'protected-checkpoint');

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }

  private assertProtection(): void {
    if (!this.isAvailable()) {
      throw new Error(messages.checkpointUnavailable);
    }
  }

  private read(): Record<string, unknown> {
    this.assertProtection();
    if (!existsSync(this.file)) return {};
    const encoded = readFileSync(this.file, 'utf8');
    const encrypted = Buffer.from(encoded, 'base64');
    if (!encoded || encrypted.toString('base64') !== encoded) {
      throw new Error('Protected checkpoint is corrupt');
    }
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Protected checkpoint is corrupt');
    return parsed as Record<string, unknown>;
  }

  private write(values: Record<string, unknown>): void {
    this.assertProtection();
    mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    const encrypted = safeStorage.encryptString(JSON.stringify(values));
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {
      try {
        writeFileSync(descriptor, encrypted.toString('base64'));
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, this.file);
      if (process.platform !== 'win32') {
        const directory = openSync(app.getPath('userData'), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      }
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }

  getItem<T = unknown>(path: string): T | null { return (this.read()[path] as T | undefined) ?? null; }
  setItem(path: string, data: unknown): void { const values = this.read(); values[path] = data; this.write(values); }
  removeItem(path: string): void { const values = this.read(); delete values[path]; this.write(values); }
  searchItems<T = unknown>(root: string, callback: (item: T) => boolean): T[] {
    return Object.entries(this.read()).filter(([key]) => key.includes(root)).map(([, value]) => value as T).filter(callback);
  }
  searchItem<T = unknown>(root: string, callback: (item: T) => boolean): T | undefined { return this.searchItems(root, callback)[0]; }
  clean(root?: string): void {
    const values = this.read();
    for (const key of Object.keys(values)) if (!root || key.includes(root)) delete values[key];
    this.write(values);
  }
  multiRemove(root: string, keys: string[]): void {
    const values = this.read();
    for (const key of keys) delete values[key.startsWith(root) ? key : `${root}/${key}`];
    this.write(values);
  }
  async savePayload(planId: string, payload: unknown): Promise<boolean> { this.setItem(`payload/${planId}`, payload); return true; }
  async getPayload<T = unknown>(planId: string): Promise<T | null> { return this.getItem<T>(`payload/${planId}`); }
  async removePlan(planId: string): Promise<void> { this.removeItem(`payload/${planId}`); }
  async save(record: EditRecoveryRecord): Promise<boolean> {
    try { this.setItem(`plan-edit/recovery/${record.planId}`, record); return true; }
    catch { return false; }
  }
  async load(planId: string): Promise<EditRecoveryRecord | null> {
    const record = this.getItem<EditRecoveryRecord>(`plan-edit/recovery/${planId}`);
    if (record && (record.planId !== planId || !record.organizationId || !record.editId || !record.assetId || !record.material || typeof record.material !== 'object')) throw new Error('Protected checkpoint is corrupt');
    return record;
  }
  async remove(planId: string): Promise<void> {
    const values = this.read();
    const recovery = values[`plan-edit/recovery/${planId}`] as EditRecoveryRecord | undefined;
    const attempt = values['plan-edit/attempt'] as { planId?: string; editId?: string } | undefined;
    if (recovery && recovery.planId !== planId) throw new Error('Protected checkpoint is corrupt');
    if (attempt?.planId === planId && recovery && attempt.editId !== recovery.editId) throw new Error('Protected checkpoint session mismatch');
    delete values[`plan-edit/recovery/${planId}`];
    if (attempt?.planId === planId) delete values['plan-edit/attempt'];
    this.write(values);
  }
}
