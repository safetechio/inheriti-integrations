import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cliTarball } from './fixtures/cli-tarball.js';
import { loadGithubDevArtifact, uploadGithubDevArtifact } from '../src/commands/github-dev-artifact.js';

const previous = process.env.INHERITI_ELEMENTS_STATE_DIR;
const previousHome = process.env.HOME;
let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.INHERITI_ELEMENTS_STATE_DIR;
  else process.env.INHERITI_ELEMENTS_STATE_DIR = previous;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
});
async function profile(marker = 'dev', version = '0.0.24-dev.1', name?: string) {
  directory = await mkdtemp(join(tmpdir(), 'github-dev-artifact-'));
  process.env.INHERITI_ELEMENTS_STATE_DIR = directory;
  const tarball = join(directory, 'cli.tgz');
  const bytes = cliTarball(version, { deployment: marker, ...(name ? { name, bin: { 'inheriti-dev': 'dist/main.js' } } : {}) });
  await writeFile(tarball, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory, 'github-dev-cli.json'), JSON.stringify({ schema: 1, deployment: 'dev', tarball,
    cliVersion: version, sha256, artifactApiUrl: 'http://127.0.0.1:3400/', downloadOrigin: 'https://tunnel.example' }), { mode: 0o600 });
  return { bytes, sha256 };
}
it('accepts a protected DEV profile with matching CLI package, marker, and digest', async () => {
  const { bytes, sha256 } = await profile();
  const artifact = await loadGithubDevArtifact();
  expect(artifact?.bytes).toEqual(bytes);
  expect(artifact?.profile.sha256).toBe(sha256);
});
it('rejects a package from another deployment', async () => {
  await profile('stg');
  await expect(loadGithubDevArtifact()).rejects.toThrow('github_dev_artifact_tarball_invalid');
});
it('identifies a Business download in a protected DEV profile', async () => {
  await profile('dev', '0.0.24-dev.1', '@safetech/inheriti-cli-dev');
  await expect(loadGithubDevArtifact()).rejects.toThrow('automation_cli_tarball_business_download');
});
it('rejects a profile readable by other users', async () => {
  await profile();
  const { chmod } = await import('node:fs/promises');
  await chmod(join(directory, 'github-dev-cli.json'), 0o644);
  await expect(loadGithubDevArtifact()).rejects.toThrow('github_dev_artifact_profile_invalid');
});
it('rejects malformed profile JSON data with a stable error', async () => {
  await profile();
  await writeFile(join(directory, 'github-dev-cli.json'), 'null', { mode: 0o600 });
  await expect(loadGithubDevArtifact()).rejects.toThrow('github_dev_artifact_profile_invalid');
});
it('validates the signed upload response and returns its URL only to the caller', async () => {
  await profile();
  process.env.HOME = directory;
  const tokenDir = join(directory, '.local/state/inheriti');
  await mkdir(tokenDir, { recursive: true });
  await writeFile(join(tokenDir, 'cli-artifact-upload-token'), Buffer.alloc(32, 7).toString('base64url'), { mode: 0o600 });
  const artifact = (await loadGithubDevArtifact())!;
  const request = async () => new Response(JSON.stringify({ id: 'artifact_1', sha256: artifact.profile.sha256,
    expiresInSeconds: 900, downloadPath: '/test/cli-artifacts/artifact_1?expires=9999999999&signature=signed',
    deletePath: '/test/cli-artifacts/artifact_1?expires=9999999999&signature=delete' }), { status: 200 });
  await expect(uploadGithubDevArtifact(artifact, request as typeof fetch)).resolves.toBe(
    'https://tunnel.example/test/cli-artifacts/artifact_1?expires=9999999999&signature=signed');
  const bad = async () => new Response(JSON.stringify({ id: 'artifact_1', sha256: '0'.repeat(64),
    expiresInSeconds: 900, downloadPath: '/test/cli-artifacts/artifact_1?expires=9999999999&signature=signed',
    deletePath: '/test/cli-artifacts/artifact_1?expires=9999999999&signature=delete' }), { status: 200 });
  await expect(uploadGithubDevArtifact(artifact, bad as typeof fetch)).rejects.toThrow('github_dev_artifact_response_invalid');
});
