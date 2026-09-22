import { createHash } from 'node:crypto';

/**
 * Chrome's id derivation: the first 128 bits of the SHA-256 of the public key, hex, with each digit
 * mapped into a–p. The same function Chrome applies to a manifest `key`, so a build and its
 * registration can agree on the id before the browser has ever loaded the extension.
 */
export function chromeExtensionId(manifestKeyBase64) {
  const digest = createHash('sha256').update(Buffer.from(manifestKeyBase64, 'base64')).digest('hex').slice(0, 32);
  return [...digest].map((character) => String.fromCharCode(97 + Number.parseInt(character, 16))).join('');
}

export function manifestKeyForBuild(deployment, sourceKey, environment = process.env) {
  const override = environment.INHERITI_GUARD_MANIFEST_KEY;
  if (override && deployment !== 'prod') throw new Error('INHERITI_GUARD_MANIFEST_KEY is only valid for prod builds.');
  return deployment === 'prod' && override ? override : sourceKey;
}
