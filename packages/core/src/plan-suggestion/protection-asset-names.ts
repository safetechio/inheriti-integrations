import { quickPlanAssetCatalog } from '../quick-plan.js';

/** Keeps suggested public names readable without using protected values. */
export class ProtectionAssetNames {
  readableEntry(label: string, index: number): string {
    return /^[\p{L}_][\p{L}\p{N}_ -]{0,48}$/u.test(label)
      ? label.replace(/_/gu, ' ').toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
      : `Entry ${index + 1}`;
  }

  normalized(value: string): string {
    return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  }

  isGeneric(name: string): boolean {
    return ['New asset', ...quickPlanAssetCatalog.map(({ id }) => id.replace(/-/gu, ' '))]
      .some((generic) => this.normalized(name) === this.normalized(generic));
  }
}
