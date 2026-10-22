import { expect, it, vi } from 'vitest';
import { resolveAutomationImage } from '../src/automation-image.js';

const sha = 'sha256:' + 'a'.repeat(64);
it('passes immutable images through without provider calls', async () => {
  const run = vi.fn();
  expect(await resolveAutomationImage(`repo@${sha}`, 'AWS', undefined, run)).toBe(`repo@${sha}`);
  expect(run).not.toHaveBeenCalled();
});

it('resolves a private ECR tag using registry region and account', async () => {
  const run = vi.fn(async () => JSON.stringify({ imageDetails: [{ imageDigest: sha }] }));
  const repository = '123456789012.dkr.ecr.us-east-1.amazonaws.com/team/worker';
  expect(await resolveAutomationImage(`${repository}:v1`, 'AWS', undefined, run)).toBe(`${repository}@${sha}`);
  expect(run).toHaveBeenCalledWith('aws', expect.arrayContaining(['--region', 'us-east-1', '--registry-id', '123456789012', '--repository-name', 'team/worker', '--image-ids', 'imageTag=v1']), undefined);
});

it('resolves Artifact Registry tags and rejects unsupported registries', async () => {
  const run = vi.fn(async (_binary: 'aws' | 'gcloud', _args: string[]) => JSON.stringify({ image_summary: { digest: sha } }));
  const repository = 'us-central1-docker.pkg.dev/my-project/repository/worker';
  expect(await resolveAutomationImage(`${repository}:v1`, 'GOOGLE_CLOUD', undefined, run)).toBe(`${repository}@${sha}`);
  expect(run).toHaveBeenCalledWith('gcloud', expect.arrayContaining(['--project', 'my-project']), undefined);
  expect(run.mock.calls[0]?.[1]).not.toContain('--location');
  await expect(resolveAutomationImage('docker.io/team/worker:v1', 'GOOGLE_CLOUD', undefined, run)).rejects.toThrow('automation_image_artifact_target_invalid');
  await expect(resolveAutomationImage('worker:bad tag', 'AWS', undefined, run)).rejects.toThrow('automation_image_digest_required');
});
