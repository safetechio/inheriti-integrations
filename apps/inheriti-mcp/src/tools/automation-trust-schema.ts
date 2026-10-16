import { z } from 'zod';

export const trustSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('GITHUB_ACTIONS_OIDC'),
    repositoryName: z
      .string()
      .min(1)
      .describe(
        'Exact owner/repository from the GitHub repository URL; with authorized gh access use gh repo ' +
          'view --json nameWithOwner --jq .nameWithOwner.',
      ),
    environment: z
      .string()
      .min(1)
      .describe(
        'Exact job environment from GitHub repository Settings > Environments and the workflow job environment field.',
      ),
    workflow: z
      .string()
      .min(1)
      .describe(
        'Full owner/repository/.github/workflows/FILE.yml@refs/heads/BRANCH for the workflow file and ' +
          'branch that will run the job; ask for these if unavailable. This must match GitHub ' +
          'workflow_ref.',
      ),
  }),
  z.object({
    method: z.literal('GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'),
    audienceBase: z
      .string()
      .min(1)
      .describe(
        'Stable nonsecret audience base URI chosen by the user for this integration, not fetched from ' +
          'Google. The connection ID is appended automatically; return the exact expected audience to ' +
          'configure on the workload.',
      ),
    serviceAccountSubject: z
      .string()
      .regex(/^\d+$/)
      .describe(
        'Numeric unique ID of the service account attached to the Google workload; use ' +
          'inspect_automation_cloud_identity for an existing Cloud Run job. ' +
          'Do not use its email address as the subject.',
      ),
  }),
  z.object({
    method: z.literal('AWS_IAM_ROLE'),
    roleArn: z
      .string()
      .min(1)
      .describe(
        'Exact ECS taskRoleArn from the task definition; use inspect_automation_cloud_identity ' +
          'for an existing ECS service. Do not use executionRoleArn, static access keys, or a personal role.',
      ),
  }),
  z.object({
    method: z.literal('PORTABLE_SIGNED_ASSERTION'),
    keyId: z.string().min(1).describe('Stable key ID the runner uses with its Ed25519 key pair.'),
    publicKey: z
      .string()
      .min(1)
      .describe('Runner Ed25519 public key in PEM format. Never request or send its private key.'),
    runnerSubject: z
      .string()
      .min(1)
      .describe(
        'Stable nonsecret subject name configured on the runner; ask if it cannot be inspected.',
      ),
    environment: z
      .string()
      .min(1)
      .describe('Exact environment name configured on the runner; ask if it cannot be inspected.'),
  }),
]);
