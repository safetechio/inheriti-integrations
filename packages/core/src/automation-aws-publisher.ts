import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient, UpdateSecretVersionStageCommand } from '@aws-sdk/client-secrets-manager';
import { DescribeParametersCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

type Clients = { secrets: Pick<SecretsManagerClient, 'send'>; ssm: Pick<SSMClient, 'send'>; sts: Pick<STSClient, 'send'> };
type Options = { region: string; expectedAccountId: string; clients?: Clients };
type Inspection = { target: string; exists: boolean; version?: string };
type Publication = { target: string; version: string; status: 'created' | 'updated' };

const secretName = (name: string) => /^[A-Za-z0-9/_+=.@-]{1,512}$/.test(name);
const parameterName = (name: string) => /^\/(?!aws\/|ssm\/)[A-Za-z0-9_.\/-]{1,1010}$/i.test(name) && !name.includes('//');
const missing = (error: unknown) => !!error && typeof error === 'object' && 'name' in error && error.name === 'ResourceNotFoundException' ||
  !!error && typeof error === 'object' && 'name' in error && error.name === 'ParameterNotFound';

export function createAwsSecretPublisher({ region, expectedAccountId, clients }: Options) {
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region) || !/^\d{12}$/.test(expectedAccountId))
    throw new Error('automation_aws_publisher_input_invalid');
  const aws = clients ?? {
    secrets: new SecretsManagerClient({ region, maxAttempts: 1 }),
    ssm: new SSMClient({ region, maxAttempts: 1 }),
    sts: new STSClient({ region, maxAttempts: 1 }),
  };
  const identity = async () => {
    try {
      const result = await aws.sts.send(new GetCallerIdentityCommand({}));
      if (result.Account !== expectedAccountId) throw new Error('automation_aws_account_mismatch');
    } catch (error) {
      if (error instanceof Error && error.message === 'automation_aws_account_mismatch') throw error;
      throw new Error('automation_aws_provider_failed');
    }
  };
  const inspectSecret = async (name: string): Promise<Inspection> => {
    if (!secretName(name)) throw new Error('automation_aws_publisher_input_invalid');
    await identity();
    try {
      const result = await aws.secrets.send(new DescribeSecretCommand({ SecretId: name }));
      if (result.OwningService) throw new Error('automation_aws_secret_service_managed');
      if (result.RotationEnabled) throw new Error('automation_aws_secret_rotation_enabled');
      if (result.PrimaryRegion) throw new Error('automation_aws_secret_replica');
      const version = Object.keys(result.VersionIdsToStages ?? {}).find(id => result.VersionIdsToStages?.[id]?.includes('AWSCURRENT'));
      return { target: name, exists: true, ...(version ? { version } : {}) };
    } catch (error) {
      if (missing(error)) return { target: name, exists: false };
      if (error instanceof Error && ['automation_aws_secret_service_managed', 'automation_aws_secret_rotation_enabled',
        'automation_aws_secret_replica'].includes(error.message)) throw error;
      throw new Error('automation_aws_provider_failed');
    }
  };
  const describeParameter = async (name: string): Promise<{ inspection: Inspection; keyId?: string }> => {
    if (!parameterName(name)) throw new Error('automation_aws_publisher_input_invalid');
    await identity();
    try {
      const result = await aws.ssm.send(new DescribeParametersCommand({ ParameterFilters: [{ Key: 'Name', Option: 'Equals', Values: [name] }] }));
      const parameter = result.Parameters?.find(item => item.Name === name);
      if (!parameter) return { inspection: { target: name, exists: false } };
      if (parameter.Type !== 'SecureString') throw new Error('automation_aws_parameter_type_invalid');
      if (!parameter.KeyId) throw new Error('automation_aws_parameter_key_unknown');
      return { inspection: { target: name, exists: true, ...(parameter.Version === undefined ? {} : { version: String(parameter.Version) }) }, keyId: parameter.KeyId };
    } catch (error) {
      if (missing(error)) return { inspection: { target: name, exists: false } };
      if (error instanceof Error && (error.message === 'automation_aws_parameter_type_invalid' || error.message === 'automation_aws_parameter_key_unknown')) throw error;
      throw new Error('automation_aws_provider_failed');
    }
  };
  const inspectParameter = async (name: string): Promise<Inspection> => (await describeParameter(name)).inspection;
  const active = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('automation_aws_publication_canceled');
  };
  const publishSecret = async (name: string, entries: ReadonlyArray<{ key: string; value: string }>, signal?: AbortSignal): Promise<Publication> => {
    if (!secretName(name) || !entries.length || entries.some(entry => !entry || typeof entry.key !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key) || typeof entry.value !== 'string') ||
      new Set(entries.map(entry => entry.key)).size !== entries.length)
      throw new Error('automation_aws_publisher_input_invalid');
    const current = await inspectSecret(name);
    active(signal);
    try {
      const existing: Record<string, unknown> = current.exists ? await (async () => {
        if (!current.version) throw new Error('automation_aws_secret_version_unknown');
        const read = await aws.secrets.send(new GetSecretValueCommand({ SecretId: name, VersionStage: 'AWSCURRENT' }), signal ? { abortSignal: signal } : {});
        active(signal);
        if (read.VersionId !== current.version) throw new Error('automation_aws_secret_version_changed');
        if (read.SecretBinary || typeof read.SecretString !== 'string') throw new Error('automation_aws_secret_format_invalid');
        try {
          const parsed: unknown = JSON.parse(read.SecretString);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
          return parsed as Record<string, unknown>;
        } catch { throw new Error('automation_aws_secret_format_invalid'); }
      })() : {};
      const value = JSON.stringify({ ...existing, ...Object.fromEntries(entries.map(entry => [entry.key, entry.value])) });
      active(signal);
      const stage = 'INHERITI_PUBLISH';
      const result = current.exists
        ? await aws.secrets.send(new PutSecretValueCommand({ SecretId: name, SecretString: value, VersionStages: [stage] }), signal ? { abortSignal: signal } : {})
        : await aws.secrets.send(new CreateSecretCommand({ Name: name, SecretString: value }), signal ? { abortSignal: signal } : {});
      if (!result.VersionId) throw new Error('automation_aws_provider_failed');
      if (current.exists) {
        const removeStage = () => aws.secrets.send(new UpdateSecretVersionStageCommand({ SecretId: name,
          VersionStage: stage, RemoveFromVersionId: result.VersionId }));
        try {
          active(signal);
          await aws.secrets.send(new UpdateSecretVersionStageCommand({ SecretId: name, VersionStage: 'AWSCURRENT',
            MoveToVersionId: result.VersionId, RemoveFromVersionId: current.version }), signal ? { abortSignal: signal } : {});
        } catch {
          try { await removeStage(); } catch { /* The version remains staged; no current value was overwritten. */ }
          throw new Error('automation_aws_secret_promotion_failed');
        }
        try { await removeStage(); } catch { /* AWSCURRENT is committed; the fixed label can be reused. */ }
      }
      return { target: name, version: result.VersionId, status: current.exists ? 'updated' : 'created' };
    } catch (error) {
      if (error instanceof Error && ['automation_aws_secret_version_unknown', 'automation_aws_secret_version_changed',
        'automation_aws_secret_format_invalid', 'automation_aws_secret_promotion_failed',
        'automation_aws_publication_canceled'].includes(error.message)) throw error;
      throw new Error('automation_aws_provider_failed');
    }
  };
  const publishParameter = async (name: string, value: string, signal?: AbortSignal): Promise<Publication> => {
    if (!parameterName(name) || typeof value !== 'string') throw new Error('automation_aws_publisher_input_invalid');
    const { inspection: current, keyId } = await describeParameter(name);
    active(signal);
    try {
      const result = await aws.ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: 'SecureString', Overwrite: current.exists, ...(keyId ? { KeyId: keyId } : {}) }), signal ? { abortSignal: signal } : {});
      if (result.Version === undefined) throw new Error('automation_aws_provider_failed');
      return { target: name, version: String(result.Version), status: current.exists ? 'updated' : 'created' };
    } catch { throw new Error('automation_aws_provider_failed'); }
  };
  return { inspectSecret, publishSecret, inspectParameter, publishParameter };
}
