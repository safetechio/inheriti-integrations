import { TextEncoder as NodeTextEncoder } from 'node:util';

const Encoder = globalThis.TextEncoder ?? NodeTextEncoder;
// jsdom can expose Node's encoder with a different Uint8Array realm than the SDK.
if (!(new Encoder().encode('') instanceof Uint8Array)) {
  globalThis.TextEncoder = class extends NodeTextEncoder {
    encode(input?: string) {
      return Uint8Array.from(super.encode(input));
    }
  };
}
