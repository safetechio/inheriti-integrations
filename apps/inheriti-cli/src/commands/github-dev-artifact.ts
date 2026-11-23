import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { automationCliTarballError, readCliTarball } from './automation-cli-tarball.js';

type Profile = { schema: 1; deployment: 'dev'; tarball: string; cliVersion: string; sha256: string;
  artifactApiUrl: string; downloadOrigin: string };
const stateRoot = () => process.env.INHERITI_ELEMENTS_STATE_DIR ?? join(process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? homedir(), '.local', 'state'), 'inheriti');
const origin = (raw: string, protocol: 'http:' | 'https:') => {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('github_dev_artifact_profile_invalid'); }
  if (url.protocol !== protocol || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('github_dev_artifact_profile_invalid');
  return url;
};
export async function loadGithubDevArtifact(): Promise<{ profile: Profile; bytes: Buffer } | undefined> {
  const path = join(stateRoot(), 'github-dev-cli.json');
  let file;
  try { file = await stat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('github_dev_artifact_profile_invalid');
  }
  if (!file.isFile() || (file.mode & 0o077)) throw new Error('github_dev_artifact_profile_invalid');
  let profile: Profile;
  try { profile = JSON.parse(await readFile(path, 'utf8')) as Profile; }
  catch { throw new Error('github_dev_artifact_profile_invalid'); }
  if (!profile || typeof profile !== 'object' || profile.schema !== 1 || profile.deployment !== 'dev' ||
      typeof profile.tarball !== 'string' || !isAbsolute(profile.tarball) || !profile.tarball.endsWith('.tgz') ||
      typeof profile.cliVersion !== 'string' || !/^\d+\.\d+\.\d+-dev\.\d+$/u.test(profile.cliVersion) ||
      typeof profile.sha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(profile.sha256) ||
      typeof profile.artifactApiUrl !== 'string' || typeof profile.downloadOrigin !== 'string')
    throw new Error('github_dev_artifact_profile_invalid');
  origin(profile.artifactApiUrl, 'http:');
  if (profile.downloadOrigin !== origin(profile.downloadOrigin, 'https:').origin)
    throw new Error('github_dev_artifact_profile_invalid');
  const bytes = await readCliTarball(profile.tarball);
  if (!bytes) throw new Error('github_dev_artifact_tarball_invalid');
  if (createHash('sha256').update(bytes).digest('hex') !== profile.sha256.toLowerCase()) throw new Error('github_dev_artifact_digest_mismatch');
  const invalid = automationCliTarballError(bytes, profile.cliVersion);
  if (invalid) throw new Error(invalid === 'automation_cli_tarball_invalid' ? 'github_dev_artifact_tarball_invalid' : invalid);
  return { profile, bytes };
}
export async function uploadGithubDevArtifact(artifact: { profile: Profile; bytes: Buffer }, request: typeof fetch = fetch): Promise<string> {
  let token: string;
  try {
    const path = join(process.env.HOME ?? homedir(), '.local/state/inheriti/cli-artifact-upload-token');
    const file = await stat(path);
    if (!file.isFile() || (file.mode & 0o077)) throw new Error('invalid');
    token = (await readFile(path, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) throw new Error('invalid');
  } catch { throw new Error('github_dev_artifact_token_invalid'); }
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(artifact.bytes)]), 'cli.tgz');
  const endpoint = new URL('/test/cli-artifacts', artifact.profile.artifactApiUrl);
  let response: Response;
  try { response = await request(endpoint, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } }); }
  catch { throw new Error('github_dev_artifact_upload_failed'); }
  if (!response.ok) throw new Error('github_dev_artifact_upload_failed');
  let item: Record<string, unknown>;
  try { item = await response.json() as Record<string, unknown>; }
  catch { throw new Error('github_dev_artifact_response_invalid'); }
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(item.id) || item.sha256 !== artifact.profile.sha256 ||
      typeof item.downloadPath !== 'string' || typeof item.deletePath !== 'string' ||
      typeof item.expiresInSeconds !== 'number' || item.expiresInSeconds < 360)
    throw new Error('github_dev_artifact_response_invalid');
  const download = new URL(item.downloadPath, artifact.profile.downloadOrigin);
  const deletion = new URL(item.deletePath, artifact.profile.artifactApiUrl);
  if (!item.downloadPath.startsWith('/') || download.origin !== origin(artifact.profile.downloadOrigin, 'https:').origin ||
      download.pathname !== `/test/cli-artifacts/${item.id}` || download.searchParams.size !== 2 ||
      !download.searchParams.get('signature') || !/^\d+$/u.test(download.searchParams.get('expires') ?? '') || download.hash ||
      !item.deletePath.startsWith('/') || deletion.pathname !== `/test/cli-artifacts/${item.id}` ||
      deletion.origin !== endpoint.origin || deletion.searchParams.size !== 2 || !deletion.searchParams.get('signature') ||
      !/^\d+$/u.test(deletion.searchParams.get('expires') ?? '') || deletion.hash)
    throw new Error('github_dev_artifact_response_invalid');
  return download.href;
}
