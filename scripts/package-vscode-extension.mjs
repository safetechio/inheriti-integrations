import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { matchingBuildDeployment, packageVersionForDeployment } from './build-deployment.mjs';
import { packageDirectory } from './package-directory.mjs';

/**
 * Packages the extension as a real `.vsix`, the only thing `code --install-extension` accepts.
 *
 * The manifest is staged rather than shipped as-is, for two reasons. A VSIX identifier is
 * `<publisher>.<name>` and neither may be scoped, so the workspace's `@safetech/…-vscode-extension`
 * cannot be used verbatim — and the identifier is not cosmetic here: the OAuth callback comes back
 * as `vscode://safetech.inheriti-integrations/oauth/callback`, so the installed extension has to carry
 * exactly that publisher and name or the sign-in redirect reaches no handler. The second reason is
 * the same as the CLI's: the bundle already contains both SDKs, and their `link:` specifiers must not
 * travel with it.
 */
const PUBLISHER = 'safetech';
const NAME = 'inheriti-integrations';

const root = process.cwd();
const deployment = await matchingBuildDeployment(root);
const production = deployment === 'prod';
const artifacts = resolve(root, process.argv.find((value) => value.startsWith('--artifacts-dir='))?.slice(16) ?? 'artifacts');
const stage = resolve(artifacts, 'stage');

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = packageVersionForDeployment(manifest.version === '0.0.0' ? '0.0.1' : manifest.version, deployment);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(resolve(root, 'dist'), resolve(stage, 'dist'), { recursive: true });
await cp(resolve(root, 'media'), resolve(stage, 'media'), { recursive: true });

await writeFile(resolve(stage, 'package.json'), `${JSON.stringify({
  name: NAME,
  displayName: production ? 'Inheriti® IDE for VS Code' : 'Inheriti® IDE for VS Code (Development Only)',
  publisher: PUBLISHER,
  version,
  description: manifest.description,
  license: 'SEE LICENSE IN README.md',
  engines: manifest.engines,
  extensionKind: manifest.extensionKind,
  categories: manifest.categories,
  icon: manifest.icon,
  main: manifest.main,
  activationEvents: manifest.activationEvents,
  contributes: {
    ...manifest.contributes,
    commands: manifest.contributes.commands.filter(({ command }) => command !== 'inheriti.importConfiguration'),
    menus: Object.fromEntries(Object.entries(manifest.contributes.menus).map(([key, items]) => [
      key, items.filter(({ command }) => command !== 'inheriti.importConfiguration'),
    ])),
    configuration: undefined,
  },
}, null, 2)}\n`);

await writeFile(resolve(stage, 'README.md'), [
  production ? '# Inheriti® IDE for VS Code' : '# Inheriti® IDE for VS Code (Development Only)',
  '',
  production ? 'A LIVE build of Inheriti® IDE for VS Code.' : 'A TEST-only build of Inheriti® IDE for VS Code, packaged for local installation.',
  production ? 'Distributed privately through Inheriti Business.' : 'It is not published to any marketplace and reaches no production environment.',
  '',
  `This build is locked to the **${deployment}** deployment.`,
  '',
].join('\n'));

const vsce = resolve(await packageDirectory(root, '@vscode/vsce'), 'vsce');
const result = spawnSync(process.execPath, [
  vsce, 'package',
  '--no-dependencies',
  '--allow-missing-repository',
  '--skip-license',
  '--out', resolve(artifacts, `${NAME}-${version}.vsix`),
], { cwd: stage, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
await rm(stage, { recursive: true, force: true });
