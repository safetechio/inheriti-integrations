import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

type Client = Pick<SecretManagerServiceClient, 'getSecret' | 'createSecret' | 'addSecretVersion'>;
type Inspection = { target: string; exists: boolean; managedByInheriti?: boolean };

const notFound = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 5;
const validSecretId = (value: string) => /^[A-Za-z0-9_-]{1,255}$/.test(value);

export function createGoogleSecretPublisher({ projectId, client = new SecretManagerServiceClient() }: {
  projectId: string; client?: Client;
}) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('google_secret_project_invalid');
  const parent = `projects/${projectId}`;
  const inspectSecret = async (secretId: string): Promise<Inspection> => {
    if (!validSecretId(secretId)) throw new Error('google_secret_name_invalid');
    const target = `${parent}/secrets/${secretId}`;
    try {
      const [secret] = await client.getSecret({ name: target });
      return { target, exists: true, managedByInheriti: secret.labels?.inheriti_managed === 'true' };
    } catch (error) {
      if (notFound(error)) return { target, exists: false };
      throw new Error('google_secret_provider_failed');
    }
  };
  const publishSecret = async (secretId: string, value: string, signal?: AbortSignal) => {
    if (!validSecretId(secretId) || typeof value !== 'string') throw new Error('google_secret_input_invalid');
    const current = await inspectSecret(secretId);
    if (current.exists && !current.managedByInheriti) throw new Error('google_secret_not_managed');
    if (signal?.aborted) throw new Error('google_secret_publication_canceled');
    try {
      if (!current.exists) await client.createSecret({ parent, secretId,
        secret: { replication: { automatic: {} }, labels: { inheriti_managed: 'true' } } });
      if (signal?.aborted) throw new Error('google_secret_publication_canceled');
      const [version] = await client.addSecretVersion({ parent: current.target,
        payload: { data: Buffer.from(value, 'utf8') } });
      if (!version.name) throw new Error('google_secret_provider_failed');
      return { target: current.target, version: version.name, status: current.exists ? 'updated' : 'created' };
    } catch (error) {
      if (error instanceof Error && error.message === 'google_secret_publication_canceled') throw error;
      throw new Error('google_secret_provider_failed');
    }
  };
  return { inspectSecret, publishSecret };
}
