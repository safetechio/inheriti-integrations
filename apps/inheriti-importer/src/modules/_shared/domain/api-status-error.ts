export class ApiStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiStatusError';
  }
}

export function isAccessDenial(error: unknown, organizationResource = false): boolean {
  return (
    error instanceof ApiStatusError &&
    (error.status === 401 || error.status === 403 || (organizationResource && error.status === 404))
  );
}

export function preferAccessDenial(...errors: Array<Error | null | undefined>): Error | null {
  return errors.find((error) => isAccessDenial(error)) ?? errors.find(Boolean) ?? null;
}
