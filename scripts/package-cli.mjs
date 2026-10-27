import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { packageDirectory } from './package-directory.mjs';
import { matchingBuildDeployment, packageVersionForDeployment } from './build-deployment.mjs';

/**
 * Packs the CLI as an installable tarball.
 *
 * The published manifest is staged rather than reused: the workspace manifest names the two SDKs as
 * `link:` dependencies, which `npm i -g` cannot resolve anywhere but this checkout. The bundle
 * already contains them. The native credential store and Google Secret Manager client remain external.
 */
const root = process.cwd();
const deployment = await matchingBuildDeployment(root);
const artifacts = resolve(root, process.argv.find((value) => value.startsWith('--artifacts-dir='))?.slice(16) ?? 'artifacts');
const stage = resolve(artifacts, 'stage');

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const nodeEngine = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).engines?.node;
if (typeof nodeEngine !== 'string' || !nodeEngine.trim()) throw new Error('Workspace Node.js engine is required');
const packageVersion = packageVersionForDeployment(manifest.version, deployment);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(resolve(root, 'dist'), resolve(stage, 'dist'), { recursive: true });
const skill = resolve(stage, 'skill', 'inheriti-cli');
const skillSource = resolve(root, 'skill', 'inheriti-cli');
const skillSourceInfo = await lstat(skillSource);
if (!skillSourceInfo.isDirectory() || skillSourceInfo.isSymbolicLink())
  throw new Error('Unsafe CLI skill source directory.');
await skillHash(skillSource);
await cp(skillSource, skill, { recursive: true });
const skillFile = resolve(skill, 'SKILL.md');
const skillFileInfo = await lstat(skillFile);
if (!skillFileInfo.isFile() || skillFileInfo.isSymbolicLink()) throw new Error('Unsafe CLI SKILL.md file.');
const skillText = await readFile(skillFile, 'utf8');
const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(skillText);
if (!match || !/^name: /mu.test(match[1]) || !/^description: /mu.test(match[1]) || /^metadata:/mu.test(match[1]))
  throw new Error('The CLI skill needs name and description frontmatter without a source version.');
await writeFile(skillFile, `---\n${match[1]}\nmetadata:\n  version: ${packageVersion}\n---\n${skillText.slice(match[0].length)}`);
async function skillHash(directory) {
  const rootInfo = await lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Unsafe CLI skill directory.');
  const hash = createHash('sha256');
  async function visit(path) {
    for (const entry of (await readdir(path)).sort()) {
      const current = join(path, entry);
      const info = await lstat(current);
      if (info.isSymbolicLink() || !(info.isDirectory() || info.isFile())) throw new Error('Unsafe CLI skill file type.');
      if (info.isDirectory()) { await visit(current); continue; }
      hash.update(relative(directory, current).split(sep).join('/')).update('\0');
      hash.update(await readFile(current)).update('\0');
    }
  }
  await visit(directory);
  return hash.digest('hex');
}
await writeFile(resolve(stage, 'skill', 'manifest.json'), `${JSON.stringify({
  schema: 1, cliVersion: packageVersion, deployment, sha256: await skillHash(skill),
})}\n`);
// clipboardy normally ships an xsel fallback beside its package. The CLI is bundled into dist,
// so that native helper must be copied explicitly or Linux reveal succeeds and clipboard delivery
// fails afterwards with a generic Error.
const clipboardy = await packageDirectory(root, 'clipboardy');
await mkdir(resolve(stage, 'fallbacks', 'linux'), { recursive: true });
await cp(
  resolve(clipboardy, 'fallbacks', 'linux', 'xsel'),
  resolve(stage, 'fallbacks', 'linux', 'xsel'),
);

await writeFile(resolve(stage, 'package.json'), `${JSON.stringify({
  name: manifest.name,
  version: packageVersion,
  description: deployment === 'prod' ? 'Inheriti CLI.' : 'Inheriti CLI (TEST builds only).',
  type: manifest.type,
  bin: manifest.bin,
  files: ['dist', 'fallbacks', 'skill'],
  engines: { node: nodeEngine },
  scripts: { postinstall: 'node dist/main.js __skill-install' },
  dependencies: { '@napi-rs/keyring': manifest.dependencies['@napi-rs/keyring'],
    '@google-cloud/secret-manager': manifest.dependencies['@google-cloud/secret-manager'] },
  private: false,
}, null, 2)}\n`);

const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--pack-destination', artifacts],
  { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status ?? 1);
await rm(stage, { recursive: true, force: true });
