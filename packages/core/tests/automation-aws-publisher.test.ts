import { describe, expect, it, vi } from 'vitest';
import { createAwsSecretPublisher } from '../src/automation-aws-publisher.js';

const clients = () => ({
  sts: { send: vi.fn().mockResolvedValue({ Account: '123456789012' }) },
  secrets: { send: vi.fn().mockImplementation(command => command.constructor.name === 'DescribeSecretCommand'
    ? Promise.reject({ name: 'ResourceNotFoundException' }) : Promise.resolve({ VersionId: 'version-1' })) },
  ssm: { send: vi.fn().mockImplementation(command => command.constructor.name === 'DescribeParametersCommand'
    ? Promise.resolve({ Parameters: [] }) : Promise.resolve({ Version: 1 })) },
});
const publisher = (mock = clients()) => createAwsSecretPublisher({ region: 'us-east-1', expectedAccountId: '123456789012', clients: mock });

describe('AWS secret publisher', () => {
  it('creates a JSON secret with explicit string keys and returns metadata only', async () => {
    const mock = clients();
    const result = await publisher(mock).publishSecret('application/credentials', [{ key: 'TOKEN', value: 'private-value' }]);
    expect(result).toEqual({ target: 'application/credentials', version: 'version-1', status: 'created' });
    const write = mock.secrets.send.mock.calls[1]![0];
    expect(write.constructor.name).toBe('CreateSecretCommand');
    expect(write.input.SecretString).toBe('{"TOKEN":"private-value"}');
    expect(JSON.stringify(result)).not.toContain('private-value');
  });

  it('merges selected keys into the current JSON secret without dropping unrelated keys', async () => {
    const mock = clients();
    mock.secrets.send.mockImplementation(command => {
      if (command.constructor.name === 'DescribeSecretCommand') return Promise.resolve({ VersionIdsToStages: { old: ['AWSCURRENT'] } });
      if (command.constructor.name === 'GetSecretValueCommand') return Promise.resolve({ VersionId: 'old', SecretString: '{"KEEP":"unchanged","TOKEN":"old"}' });
      return Promise.resolve({ VersionId: 'new' });
    });
    const result = await publisher(mock).publishSecret('application/credentials', [{ key: 'TOKEN', value: 'private-value' }]);
    expect(result).toEqual({ target: 'application/credentials', version: 'new', status: 'updated' });
    expect(mock.secrets.send.mock.calls[2]![0].input.SecretString).toBe('{"KEEP":"unchanged","TOKEN":"private-value"}');
    expect(mock.secrets.send.mock.calls[2]![0].input.VersionStages).toEqual(['INHERITI_PUBLISH']);
    expect(mock.secrets.send.mock.calls[3]![0].input).toEqual({ SecretId: 'application/credentials',
      VersionStage: 'AWSCURRENT', MoveToVersionId: 'new', RemoveFromVersionId: 'old' });
    expect(mock.secrets.send.mock.calls[4]![0].input).toEqual({ SecretId: 'application/credentials',
      VersionStage: mock.secrets.send.mock.calls[2]![0].input.VersionStages[0], RemoveFromVersionId: 'new' });
    expect(JSON.stringify(result)).not.toContain('unchanged');
  });

  it('fails without replacing a concurrent AWSCURRENT version', async () => {
    const mock = clients();
    mock.secrets.send.mockImplementation(command => {
      if (command.constructor.name === 'DescribeSecretCommand') return Promise.resolve({ VersionIdsToStages: { old: ['AWSCURRENT'] } });
      if (command.constructor.name === 'GetSecretValueCommand') return Promise.resolve({ VersionId: 'old', SecretString: '{}' });
      if (command.constructor.name === 'PutSecretValueCommand') return Promise.resolve({ VersionId: 'staged' });
      return Promise.reject(new Error('provider response may contain private-value'));
    });
    await expect(publisher(mock).publishSecret('application/credentials', [{ key: 'TOKEN', value: 'private-value' }]))
      .rejects.toThrow('automation_aws_secret_promotion_failed');
    expect(mock.secrets.send.mock.calls[2]![0].input.VersionStages).not.toContain('AWSCURRENT');
    expect(mock.secrets.send.mock.calls[3]![0].input.RemoveFromVersionId).toBe('old');
    expect(mock.secrets.send.mock.calls[4]![0].input.RemoveFromVersionId).toBe('staged');
  });

  it('reports committed publication even when fixed-label cleanup fails', async () => {
    const mock = clients();
    mock.secrets.send.mockImplementation(command => {
      if (command.constructor.name === 'DescribeSecretCommand') return Promise.resolve({ VersionIdsToStages: { old: ['AWSCURRENT'] } });
      if (command.constructor.name === 'GetSecretValueCommand') return Promise.resolve({ VersionId: 'old', SecretString: '{}' });
      if (command.constructor.name === 'PutSecretValueCommand') return Promise.resolve({ VersionId: 'new' });
      if (command.input.VersionStage === 'INHERITI_PUBLISH') return Promise.reject(new Error('cleanup failed'));
      return Promise.resolve({});
    });
    await expect(publisher(mock).publishSecret('application/credentials', [{ key: 'TOKEN', value: 'private-value' }]))
      .resolves.toEqual({ target: 'application/credentials', version: 'new', status: 'updated' });
  });

  it('does not write after cancellation during metadata inspection', async () => {
    const mock = clients();
    const controller = new AbortController();
    let finishInspection!: (value: { Parameters: never[] }) => void;
    mock.ssm.send.mockImplementation(() => new Promise(resolve => { finishInspection = resolve; }));
    const publication = publisher(mock).publishParameter('/application/token', 'private-value', controller.signal);
    await vi.waitFor(() => expect(mock.ssm.send).toHaveBeenCalledTimes(1));
    controller.abort();
    finishInspection({ Parameters: [] });
    await expect(publication).rejects.toThrow('automation_aws_publication_canceled');
    expect(mock.ssm.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ VersionId: 'different', SecretString: '{}' }, 'automation_aws_secret_version_changed'],
    [{ VersionId: 'old', SecretBinary: new Uint8Array([1]) }, 'automation_aws_secret_format_invalid'],
    [{ VersionId: 'old', SecretString: 'not-json-private-value' }, 'automation_aws_secret_format_invalid'],
  ])('refuses changed or non-JSON existing secrets before writing', async (read, code) => {
    const mock = clients();
    mock.secrets.send.mockImplementation(command => command.constructor.name === 'DescribeSecretCommand'
      ? Promise.resolve({ VersionIdsToStages: { old: ['AWSCURRENT'] } }) : Promise.resolve(read));
    await expect(publisher(mock).publishSecret('application/credentials', [{ key: 'TOKEN', value: 'private-value' }]))
      .rejects.toThrow(code);
    expect(mock.secrets.send.mock.calls.map(call => call[0].constructor.name)).toEqual(['DescribeSecretCommand', 'GetSecretValueCommand']);
  });

  it('updates an existing SecureString without reading its value', async () => {
    const mock = clients();
    mock.ssm.send.mockImplementation(command => command.constructor.name === 'DescribeParametersCommand'
      ? Promise.resolve({ Parameters: [{ Name: '/application/token', Type: 'SecureString', Version: 3, KeyId: 'arn:aws:kms:us-east-1:123456789012:key/abc' }] }) : Promise.resolve({ Version: 4 }));
    const result = await publisher(mock).publishParameter('/application/token', 'private-value');
    expect(result).toEqual({ target: '/application/token', version: '4', status: 'updated' });
    expect(mock.ssm.send.mock.calls[0]![0].constructor.name).toBe('DescribeParametersCommand');
    expect(mock.ssm.send.mock.calls[1]![0].input).toMatchObject({ Type: 'SecureString', Overwrite: true,
      KeyId: 'arn:aws:kms:us-east-1:123456789012:key/abc' });
  });

  it('refuses an existing SecureString when its KMS key is unknown', async () => {
    const mock = clients();
    mock.ssm.send.mockResolvedValue({ Parameters: [{ Name: '/application/token', Type: 'SecureString', Version: 3 }] });
    await expect(publisher(mock).publishParameter('/application/token', 'private-value'))
      .rejects.toThrow('automation_aws_parameter_key_unknown');
    expect(mock.ssm.send).toHaveBeenCalledTimes(1);
  });

  it('rejects bad selections and account mismatch before writing', async () => {
    const mock = clients();
    const adapter = publisher(mock);
    await expect(adapter.publishSecret('valid-name', [{ key: 'KEY', value: 'a' }, { key: 'KEY', value: 'b' }]))
      .rejects.toThrow('automation_aws_publisher_input_invalid');
    expect(mock.sts.send).not.toHaveBeenCalled();
    mock.sts.send.mockResolvedValue({ Account: '000000000000' });
    await expect(adapter.publishParameter('/application/token', 'private-value'))
      .rejects.toThrow('automation_aws_account_mismatch');
    expect(mock.ssm.send).not.toHaveBeenCalled();
  });

  it('hides provider errors, including their secret-bearing message', async () => {
    const mock = clients();
    mock.sts.send.mockRejectedValue(new Error('private-value'));
    await expect(publisher(mock).publishParameter('/application/token', 'private-value'))
      .rejects.toThrow('automation_aws_provider_failed');
  });

  it.each([
    [{ OwningService: 'rds' }, 'automation_aws_secret_service_managed'],
    [{ RotationEnabled: true }, 'automation_aws_secret_rotation_enabled'],
    [{ PrimaryRegion: 'us-west-2' }, 'automation_aws_secret_replica'],
  ])('blocks unsupported existing secrets before publication', async (metadata, code) => {
    const mock = clients();
    mock.secrets.send.mockResolvedValue(metadata);
    const adapter = publisher(mock);
    await expect(adapter.inspectSecret('application/credentials')).rejects.toThrow(code);
    await expect(adapter.publishSecret('application/credentials', [{ key: 'TOKEN', value: 'private-value' }]))
      .rejects.toThrow(code);
    expect(mock.secrets.send.mock.calls.every(call => call[0].constructor.name === 'DescribeSecretCommand')).toBe(true);
  });
});
