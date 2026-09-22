import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromeExtensionId } from './chrome-extension-id.mjs';

/**
 * Mints the keypair that fixes the Chrome extension's id, once.
 *
 * Without a `key` in the manifest, Chrome derives an unpacked extension's id from its absolute path:
 * every rebuild in a new location produced a new id, which invalidated the registered OAuth redirect
 * and sent sign-in nowhere. The public half goes into the committed manifest so the id is the same
 * on every machine and in every install mode; the private half stays out of the repository and is
 * only needed to sign a `.crx`, which nothing here does.
 *
 * Run this only to mint a new identity — regenerating changes the extension's id, and every
 * registration made against the old one has to be redone.
 */
const root = resolve(import.meta.dirname, '..');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

const privateKeyFile = resolve(root, '.local/chrome-extension-key.pem');
await mkdir(resolve(root, '.local'), { recursive: true });
await writeFile(privateKeyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

process.stdout.write(`extension id: ${chromeExtensionId(key)}\nprivate key:  ${privateKeyFile}\n\nmanifest key:\n${key}\n`);
