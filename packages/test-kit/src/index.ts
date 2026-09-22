export { FakeElementsApi } from './fake-elements-api.js';
export type { FakeApiCall, FakeAssetFixture, FakeElementsApiOptions, FakeRevealStage } from './fake-elements-api.js';

export const testKitBoundary = Object.freeze({ productionImportAllowed: false });

export class FakeSecureStore<T> {
  value: T | undefined;
  load = async () => this.value;
  save = async (value: T) => { this.value = structuredClone(value); };
  clear = async () => { this.value = undefined; };
}

export class FakeKeyedStore<T> {
  readonly values = new Map<string, T>();
  load = async (key: string) => this.values.get(key);
  save = async (key: string, value: T) => { this.values.set(key, structuredClone(value)); };
  remove = async (key: string) => { this.values.delete(key); };
}

export const safeFixtures = Object.freeze({
  issuer: 'https://identity.invalid/realms/elements-test',
  clientId: 'fixture-client',
  accessToken: 'fixture.invalid.token',
  planId: 'fixture-plan-id',
});
