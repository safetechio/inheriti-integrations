import { createContext, useContext, type Dispatch } from 'react';
import {
  initialVaultState,
  type VaultAction,
  type VaultState,
} from '@modules/import/infrastructure/stores/vault-store';

type VaultContextValue = {
  state: VaultState;
  dispatch: Dispatch<VaultAction>;
};

export const VaultContext = createContext<VaultContextValue>({
  state: initialVaultState,
  dispatch: () => undefined,
});

export function useVault(): VaultContextValue {
  return useContext(VaultContext);
}
