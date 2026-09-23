import type { InternalBuild } from '@safetech/inheriti-client-sdk/node';

/** Select only a newer build for the installed channel and platform. */
export function latestIntegrationBuild(builds: readonly InternalBuild[], integration: string, version: string, platform: string): InternalBuild | undefined {
  const parsed = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:-(dev|stg)\.(\d+))?$/u.exec(value);
  const current = parsed(version);
  if (!current) return undefined;
  const channel = current[4] ?? 'prod';
  const compare = (value: string, other: string) => {
    const left = parsed(value), right = parsed(other);
    if (!left || !right || (left[4] ?? 'prod') !== channel || (right[4] ?? 'prod') !== channel) return 0;
    for (const index of [1, 2, 3, 5]) {
      const difference = Number(left[index] ?? 0) - Number(right[index] ?? 0);
      if (difference) return difference;
    }
    return 0;
  };
  return builds.filter((item) => item.integration === integration && item.platform === platform && compare(item.version, version) > 0)
    .sort((a, b) => compare(b.version, a.version))[0];
}
