import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { providerCliError } from './provider-cli-error.js';

const execFileAsync = promisify(execFile);
const digest = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/i;
const tag = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const ecr = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\/([a-z0-9]+(?:[._/-][a-z0-9]+)*)$/;
const artifact = /^([a-z0-9-]+)-docker\.pkg\.dev\/([a-z][a-z0-9-]{4,61}[a-z0-9])\/([a-z][a-z0-9-]{2,62})\/([a-z0-9]+(?:[._/-][a-z0-9]+)*)$/;
type Provider = 'AWS' | 'GOOGLE_CLOUD';
type Runner = (binary: 'aws' | 'gcloud', args: string[], signal?: AbortSignal) => Promise<string>;

const run: Runner = async (binary, args, signal) => {
  try {
    const { stdout } = await execFileAsync(binary, args, { timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true, signal });
    return stdout;
  } catch (error) {
    throw providerCliError(binary, error, 'automation_image_lookup_failed');
  }
};

/** Resolve only the target provider's registry; core mutations still require a digest. */
export async function resolveAutomationImage(image: string, provider: Provider,
  signal?: AbortSignal, runner: Runner = run): Promise<string> {
  signal?.throwIfAborted();
  if (digest.test(image)) return image;
  const separator = image.lastIndexOf(':');
  if (separator <= image.lastIndexOf('/') || !tag.test(image.slice(separator + 1)))
    throw new Error('automation_image_digest_required');
  const repository = image.slice(0, separator);
  if (provider === 'AWS') {
    const match = ecr.exec(repository);
    if (!match)
      throw new Error('automation_image_ecr_target_invalid');
    const output = await runner('aws', ['ecr', 'describe-images', '--region', match[2]!,
      '--registry-id', match[1]!, '--repository-name', match[3]!, '--image-ids', `imageTag=${image.slice(separator + 1)}`, '--output', 'json'], signal);
    let response: { imageDetails?: Array<{ imageDigest?: unknown }> };
    try { response = JSON.parse(output); } catch { throw new Error('automation_image_lookup_invalid'); }
    const resolved = response?.imageDetails?.[0]?.imageDigest;
    if (typeof resolved !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(resolved)) throw new Error('automation_image_lookup_invalid');
    return `${repository}@${resolved}`;
  }
  const match = artifact.exec(repository);
  if (!match) throw new Error('automation_image_artifact_target_invalid');
  const output = await runner('gcloud', ['artifacts', 'docker', 'images', 'describe', image,
    '--project', match[2]!, '--format=json'], signal);
  let response: { image_summary?: { digest?: unknown }; imageSummary?: { digest?: unknown }; digest?: unknown; name?: unknown };
  try { response = JSON.parse(output); } catch { throw new Error('automation_image_lookup_invalid'); }
  const resolved = response?.image_summary?.digest ?? response?.imageSummary?.digest ?? response?.digest ??
    (typeof response?.name === 'string' ? response.name.split('@')[1] : undefined);
  if (typeof resolved !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(resolved)) throw new Error('automation_image_lookup_invalid');
  return `${repository}@${resolved}`;
}
