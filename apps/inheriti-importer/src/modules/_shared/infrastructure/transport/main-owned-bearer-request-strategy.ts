export const mainOwnedBearerRequestStrategy = {
  async prepare() { return { credentials: 'omit' as const }; },
};
