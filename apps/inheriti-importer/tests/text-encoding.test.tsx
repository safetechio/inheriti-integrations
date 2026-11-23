import { expect, it } from 'vitest';

it('encodes UTF-8 bytes in the active test realm without changing their content', () => {
  const encoded = new TextEncoder().encode('é');
  expect(encoded).toBeInstanceOf(Uint8Array);
  expect([...encoded]).toEqual([195, 169]);
});
