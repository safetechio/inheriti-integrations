import { dirname, resolve } from 'node:path';
import { readOrganizationPreferences, saveOrganizationPreferences } from '@safetech/inheriti-elements-core/node-base';
import type { BusinessOrganization } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from './configuration.js';
import type { CliContext } from './session.js';
import type { Terminal } from './output.js';
import { renderJson } from './output.js';
import { promptSelect } from './render/select.jsx';
import { OperatorNotSignedIn } from './commands/plans.js';

const coded = (code: string) => Object.assign(new Error(code), { code });

export class OrganizationChoiceRequired extends Error {
  constructor(readonly code: string, readonly organizations: readonly BusinessOrganization[]) {
    super(`${code}: ${organizations.map(({ name, id }) => `${name} (${id})`).join(', ') || 'none available'}`);
  }
}

async function preferenceKey(context: CliContext, configuration: CliConfiguration): Promise<string> {
  if (!(await context.core.getAccessToken())) throw new OperatorNotSignedIn();
  const subject = (await context.sessions.load())?.principal.subject;
  if (!subject) throw new OperatorNotSignedIn();
  return JSON.stringify([configuration.issuer, configuration.environment, subject]);
}

export async function organizationCommand(
  context: CliContext, configuration: CliConfiguration, configurationPath: string,
  terminal: Terminal, argv: readonly string[],
): Promise<number> {
  const path = resolve(dirname(configurationPath), 'organizations.json');
  const key = await preferenceKey(context, configuration);
  const items = await context.core.listOrganizations();
  const selections = await readOrganizationPreferences(path);
  const saved = selections[key];
  if (saved && !items.some(({ id }) => id === saved)) { delete selections[key]; await saveOrganizationPreferences(path, selections); }
  if (argv[0] === 'list') {
    if (argv.length !== 1) throw coded('organization_command_invalid');
    renderJson(terminal, { items, selectedId: selections[key] ?? (items.length === 1 ? items[0]!.id : null) });
    return 0;
  }
  if (argv[0] === 'use') {
    if (argv.length > 2) throw coded('organization_command_invalid');
    const selected = argv[1] ?? (terminal.interactive
      ? await promptSelect('Which organization?', items.map(({ id, name }) => ({ value: id, description: name })))
      : undefined);
    if (!selected) throw new OrganizationChoiceRequired('organization_selection_required', items);
    if (!items.some(({ id }) => id === selected)) throw new OrganizationChoiceRequired('organization_access_denied', items);
    selections[key] = selected;
    await saveOrganizationPreferences(path, selections);
    terminal.write(`Selected ${items.find(({ id }) => id === selected)!.name} (${selected}).`);
    return 0;
  }
  throw coded('organization_command_invalid');
}

export async function selectedOrganization(
  context: CliContext, configuration: CliConfiguration, configurationPath: string,
  terminal: Terminal, override?: string,
): Promise<BusinessOrganization> {
  const path = resolve(dirname(configurationPath), 'organizations.json');
  const key = await preferenceKey(context, configuration);
  const items = await context.core.listOrganizations();
  const selections = await readOrganizationPreferences(path);
  const saved = selections[key];
  if (saved && !items.some(({ id }) => id === saved)) { delete selections[key]; await saveOrganizationPreferences(path, selections); }
  const selected = override ?? selections[key];
  if (selected) {
    const organization = items.find(({ id }) => id === selected);
    if (!organization) throw new OrganizationChoiceRequired('organization_access_denied', items);
    return organization;
  }
  if (items.length === 0) throw new OrganizationChoiceRequired('organization_required', items);
  if (items.length === 1) return items[0]!;
  if (!terminal.interactive) throw new OrganizationChoiceRequired('organization_selection_required', items);
  const chosen = await promptSelect('Which organization?', items.map(({ id, name }) => ({ value: id, description: name })));
  if (!chosen) throw new OrganizationChoiceRequired('organization_selection_required', items);
  selections[key] = chosen;
  await saveOrganizationPreferences(path, selections);
  return items.find(({ id }) => id === chosen)!;
}
