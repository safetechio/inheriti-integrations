import type { ActivePageSummary } from '../shared/messages.js';
import type { PageFieldTarget } from '../shared/access-contract.js';

export interface DiscoveredPageField {
  readonly targetId: string;
  readonly origin: string;
  readonly navigationId: string;
  readonly semantic: 'username' | 'email' | 'password';
  readonly label: string;
  readonly autocomplete: string;
  readonly inputType: string;
  readonly name: string;
  readonly elementId: string;
}

export interface DiscoveredPageSnapshot {
  readonly origin: string;
  readonly navigationId: string;
  readonly fields: readonly DiscoveredPageField[];
}

/** Adds browser-owned tab/frame identity after executeScript returns metadata from that exact frame. */
export function scopePageFields(
  fields: readonly DiscoveredPageField[],
  tabId: number,
  frameId: number,
): readonly PageFieldTarget[] {
  return fields.map(({ targetId, origin, navigationId, semantic, label }) => ({
    targetId, tabId, frameId, origin, navigationId, semantic, label,
  }));
}

export function collectPageSummary(): ActivePageSummary {
  const visible = (element: HTMLInputElement) => {
    const style = window.getComputedStyle(element);
    return !element.disabled && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);

  return {
    origin: window.location.origin,
    usernameFields: inputs.filter((input) =>
      input.autocomplete === 'username' || input.type === 'email' || input.type === 'text').length,
    passwordFields: inputs.filter((input) => input.type === 'password').length,
  };
}

/** Runs in an isolated page world. It records opaque, document-lifetime handles, never field values. */
export function discoverPageFields(): DiscoveredPageSnapshot {
  type Semantic = DiscoveredPageField['semantic'];
  type Registry = {
    navigationId: string;
    href: string;
    targets: Map<string, HTMLInputElement>;
  };
  const registryKey = '__inheritiPageTargetsV1__';
  const page = globalThis as typeof globalThis & { [registryKey]?: Registry };
  let registry = page[registryKey];
  if (registry === undefined || registry.href !== window.location.href) {
    registry = page[registryKey] = {
      navigationId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      href: window.location.href,
      targets: new Map<string, HTMLInputElement>(),
    };
  }
  const semanticFor = (input: HTMLInputElement): Semantic | undefined => {
    const autocomplete = input.autocomplete.toLowerCase().split(/\s+/).at(-1);
    if (autocomplete === 'username') return 'username';
    if (autocomplete === 'email') return 'email';
    if (autocomplete === 'current-password' || autocomplete === 'new-password') return 'password';
    if (input.type === 'password') return 'password';
    if (input.type === 'email') return 'email';
    if (input.type !== 'text') return undefined;
    const hint = `${input.getAttribute('aria-label') ?? ''} ${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
    if (/e-?mail/.test(hint)) return 'email';
    if (/user|login|account/.test(hint)) return 'username';
    return undefined;
  };
  const labelFor = (input: HTMLInputElement, semantic: Semantic): string => {
    const labelledBy = input.getAttribute('aria-labelledby')?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    return input.getAttribute('aria-label')?.trim()
      || labelledBy
      || Array.from(input.labels ?? []).map((label) => label.textContent?.trim()).filter(Boolean).join(' ')
      || input.placeholder.trim()
      || input.name
      || input.id
      || `${semantic[0]!.toUpperCase()}${semantic.slice(1)} field`;
  };
  const visibleEditable = (input: HTMLInputElement): boolean => {
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return !input.disabled && !input.readOnly && !input.hidden
      && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
      && rect.width > 0 && rect.height > 0;
  };

  const discovered: DiscoveredPageField[] = [];
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input'))) {
    const semantic = semanticFor(input);
    if (semantic === undefined || !visibleEditable(input)) continue;
    let targetId = Array.from(registry.targets).find(([, element]) => element === input)?.[0];
    if (targetId === undefined) {
      targetId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      registry.targets.set(targetId, input);
    }
    discovered.push({
      targetId,
      origin: window.location.origin,
      navigationId: registry.navigationId,
      semantic,
      label: labelFor(input, semantic),
      autocomplete: input.autocomplete,
      inputType: input.type,
      name: input.name,
      elementId: input.id,
    });
  }
  return { origin: window.location.origin, navigationId: registry.navigationId, fields: discovered };
}
