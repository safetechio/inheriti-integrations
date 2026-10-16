import { isGithubAutomationSelector } from './automation-setup.js';

type PlanAssetFields = { id: string; code?: string; isBinary?: boolean; fieldNames?: readonly string[] };
type FieldMapping = { selector: string; envName: string };

export type AutomationMappingSelection = {
  mapAll?: boolean;
  onlyFields?: readonly string[];
  exceptFields?: readonly string[];
  mappings?: ReadonlyArray<FieldMapping>;
};

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function invalid(): never {
  throw new Error('automation_mapping_selection_invalid');
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function envName(selector: string): string {
  const generated = selector
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
  return /^\d/.test(generated) ? `_${generated}` : generated;
}

export function resolveAutomationFieldMappings(
  assets: ReadonlyArray<PlanAssetFields>,
  selection: AutomationMappingSelection,
): FieldMapping[] {
  const available = assets.filter(asset => !asset.isBinary).flatMap(asset =>
    (asset.fieldNames ?? []).map(field => `${asset.code ?? asset.id}.${field}`));
  const only = selection.onlyFields ?? [];
  const except = selection.exceptFields ?? [];
  const manual = selection.mappings ?? [];
  const automatic = selection.mapAll === true || selection.onlyFields !== undefined;
  if ((selection.mapAll && selection.onlyFields !== undefined) ||
      (selection.exceptFields !== undefined && !selection.mapAll) ||
      (selection.mapAll && (!unique(available) || available.some(selector => !isGithubAutomationSelector(selector)))) ||
      !unique(only) || !unique(except) || !unique(manual.map(item => item.selector)) ||
      [only, except, manual.map(item => item.selector)].some(list => list.some(selector => !available.includes(selector))) ||
      manual.some(item => !ENV_NAME.test(item.envName) || item.envName.startsWith('INHERITI_AUTOMATION_'))) invalid();

  const selected = automatic
    ? available.filter(selector => selection.mapAll ? !except.includes(selector) : only.includes(selector))
    : available.filter(selector => manual.some(item => item.selector === selector));
  if (!selected.length || !unique(selected) || selected.some(selector => !isGithubAutomationSelector(selector)) ||
      manual.some(item => !selected.includes(item.selector))) invalid();

  const overrides = new Map(manual.map(item => [item.selector, item.envName]));
  const result = selected.map(selector => ({ selector, envName: overrides.get(selector) ?? envName(selector) }));
  if (!unique(result.map(item => item.envName)) || result.some(item =>
    !ENV_NAME.test(item.envName) || item.envName.startsWith('INHERITI_AUTOMATION_'))) invalid();
  return result;
}
