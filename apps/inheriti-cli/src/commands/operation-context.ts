export type OperationContext = Partial<Record<'reason' | 'commitSha' | 'workflow' | 'pipeline' | 'target' | 'image' | 'version', string>>;

const limits: Record<keyof OperationContext, number> = {
  reason: 500, commitSha: 64, workflow: 200, pipeline: 300, target: 200, image: 300, version: 100,
};
const flags: Record<string, keyof OperationContext> = {
  '--reason': 'reason', '--commit': 'commitSha', '--workflow': 'workflow', '--pipeline': 'pipeline',
  '--target': 'target', '--image': 'image', '--version': 'version',
};

export function contextFlag(option: string): keyof OperationContext | undefined {
  return Object.prototype.hasOwnProperty.call(flags, option) ? flags[option] : undefined;
}

export function validContextValue(key: keyof OperationContext, value: string): boolean {
  return value.length > 0 && value === value.trim() && value.length <= limits[key]
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && (key !== 'commitSha' || /^[0-9a-fA-F]{7,64}$/u.test(value));
}

export function automationEnvironmentContext(environment: Readonly<Record<string, string | undefined>>, explicit: OperationContext = {}): OperationContext {
  const result: OperationContext = {};
  const candidates: Array<[keyof OperationContext, string | undefined]> = [
    ['reason', environment.INHERITI_AUTOMATION_REASON],
    ['commitSha', environment.INHERITI_AUTOMATION_PROVIDER ? undefined : environment.GITHUB_SHA],
    ['workflow', environment.INHERITI_AUTOMATION_PROVIDER ? undefined : environment.GITHUB_WORKFLOW_REF ?? environment.GITHUB_WORKFLOW],
    ['target', environment.INHERITI_AUTOMATION_TARGET],
    ['image', environment.INHERITI_AUTOMATION_IMAGE],
    ['version', environment.INHERITI_AUTOMATION_VERSION],
  ];
  if (!environment.INHERITI_AUTOMATION_PROVIDER && environment.GITHUB_SERVER_URL && environment.GITHUB_REPOSITORY && environment.GITHUB_RUN_ID) {
    const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt } = environment;
    if (/^https:\/\/[A-Za-z0-9.-]+$/u.test(server) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
      && /^[0-9]+$/u.test(run) && (attempt === undefined || /^[0-9]+$/u.test(attempt))) {
      candidates.push(['pipeline', `${server}/${repository}/actions/runs/${run}${attempt ? `/attempts/${attempt}` : ''}`]);
    }
  }
  for (const [key, value] of candidates) {
    if (value !== undefined && value !== '' && explicit[key] === undefined) {
      if (!validContextValue(key, value)) throw new Error(`Invalid automation context: ${key}`);
      result[key] = value;
    }
  }
  return result;
}
