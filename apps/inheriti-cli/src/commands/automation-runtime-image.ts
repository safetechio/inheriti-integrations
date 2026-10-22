import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { automationRuntimeInstallInstructions, resolveAutomationImage } from '@safetech/inheriti-elements-core/node-base';
import type { Terminal } from '../output.js';

const execFileAsync = promisify(execFile);
const usage = 'Usage: inheriti automations runtime image --image ECR_OR_ARTIFACT_REGISTRY_TAG [--context DIRECTORY] [--dockerfile FILE] [--cli-tarball PATH] [--build | --publish]';
const ecrTag = /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const artifactTag = /^[a-z0-9-]+-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/[a-z][a-z0-9-]{2,62}\/[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
type Runner = (args: string[], signal?: AbortSignal) => Promise<string>;
const runDocker: Runner = async (args, signal) => {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout: 1_200_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal,
    });
    return stdout.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('Docker CLI is required. Install Docker and start it before building the image.');
    throw new Error(`Docker ${args[0]} failed. Check Docker access, the Dockerfile, and registry sign-in.`);
  }
};

export async function automationRuntimeImage(
  terminal: Terminal, cliVersion: string, argv: readonly string[], signal?: AbortSignal,
  docker: Runner = runDocker,
  resolveImage = resolveAutomationImage,
): Promise<number> {
  const options: Record<string, string> = {};
  let action: 'preview' | 'build' | 'publish' = 'preview';
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]!;
    if (key === '--build' || key === '--publish') {
      if (action !== 'preview') { terminal.writeError(usage); return 1; }
      action = key.slice(2) as 'build' | 'publish';
    } else if (['--image', '--context', '--dockerfile', '--cli-tarball'].includes(key) && !options[key] &&
      argv[index + 1] && !argv[index + 1]!.startsWith('--')) {
      options[key] = argv[++index]!;
    } else { terminal.writeError(usage); return 1; }
  }
  const image = options['--image'];
  const provider = image && ecrTag.test(image) ? 'AWS' : image && artifactTag.test(image) ? 'GOOGLE_CLOUD' : undefined;
  if (!image || !provider) {
    terminal.writeError(usage);
    return 1;
  }
  const context = options['--context'] ?? '.';
  const dockerfile = options['--dockerfile'] ?? 'Dockerfile';
  const tarball = options['--cli-tarball'] && resolve(options['--cli-tarball']);
  const local = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-local\.(0|[1-9]\d*)$/.test(cliVersion);
  if (local && action !== 'preview' && !tarball) {
    terminal.writeError('A local CLI build requires --cli-tarball PATH for --build or --publish.');
    return 1;
  }
  if (tarball) {
    if (!(local || /-dev\./.test(cliVersion)) || !tarball.endsWith('.tgz') || !(await stat(tarball).then(file => file.isFile()).catch(() => false))) {
      terminal.writeError('--cli-tarball requires a local or dev CLI version and an existing .tgz file.');
      return 1;
    }
  }
  const packageSpec = local ? undefined : automationRuntimeInstallInstructions({ cliVersion }).packageSpec;
  terminal.write(`Image: ${image}\nDockerfile: ${dockerfile}\nBuild context: ${context}\n` +
    `The CLI will add Inheriti CLI ${cliVersion} to the built application image.\n` +
    `The final application image needs npm, Node.js and a shell.\n` +
    `Next: ${action === 'preview' ? 'add --build to verify locally, or --publish to build and push' :
      action === 'build' ? 'build and verify locally' : 'build, verify, and push to the registry'}.`);
  if (action === 'preview') return 0;
  const sourceImage = `inheriti-runtime-source:${randomUUID()}`;
  await docker(['build', '--file', dockerfile, '--tag', sourceImage, context], signal);
  try {
    const user = await docker(['image', 'inspect', '--format', '{{.Config.User}}', sourceImage], signal);
    if (user && !/^[A-Za-z0-9_.:-]+$/.test(user)) throw new Error('The application image has an unsupported runtime user.');
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-image-'));
    try {
      const generatedDockerfile = join(directory, 'Dockerfile');
      if (tarball) await copyFile(tarball, join(directory, 'cli.tgz'));
      await writeFile(generatedDockerfile,
        `FROM ${sourceImage}\nUSER 0\n${tarball ? 'COPY cli.tgz /tmp/inheriti-cli.tgz\n' : ''}RUN npm install --engine-strict --global --prefix /usr/local ${tarball ? '/tmp/inheriti-cli.tgz' : packageSpec} && test "$(/usr/local/bin/inheriti --version)" = '${cliVersion}'${tarball ? ' && rm /tmp/inheriti-cli.tgz' : ''}\n${user ? `USER ${user}\n` : ''}`);
      try { await docker(['build', '--file', generatedDockerfile, '--tag', image, directory], signal); }
      catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`Could not add Inheriti CLI to the image. Its final stage needs npm, Node.js and a shell${tarball ? '.' : '; this CLI version must also be published on npm.'}`);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
    const installedVersion = await docker(['run', '--rm', '--entrypoint', '/usr/local/bin/inheriti', image, '--version'], signal);
    if (installedVersion !== cliVersion)
      throw new Error(`Image CLI version is ${installedVersion || 'unavailable'}; expected ${cliVersion}.`);
    terminal.write(`Image built with Inheriti CLI ${cliVersion}: ${image}`);
    if (action === 'publish') {
      await docker(['push', image], signal);
      terminal.write(`Published image: ${await resolveImage(image, provider, signal)}`);
      terminal.write('Use this image for pairing or automations setup --apply. Deploy a ready Cloud Run revision before pairing.');
    }
  } finally {
    await docker(['image', 'rm', sourceImage]).catch(() => {});
  }
  return 0;
}
