import type { DiscoveredPageField } from './page-inspection.js';

/** Runs in an isolated page world until the operator clicks a compatible input or presses Escape. */
export function pickPageField(): Promise<DiscoveredPageField | null> {
  type Semantic = DiscoveredPageField['semantic'];
  type Registry = { navigationId: string; href: string; targets: Map<string, HTMLInputElement> };
  type PickerState = { cancel: () => void };
  const registryKey = '__inheritiElementsPageTargetsV1__';
  const pickerKey = '__inheritiElementsPagePickerV1__';
  const page = globalThis as typeof globalThis & {
    [registryKey]?: Registry;
    [pickerKey]?: PickerState;
  };
  page[pickerKey]?.cancel();
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
    if (autocomplete === 'current-password' || autocomplete === 'new-password' || input.type === 'password') return 'password';
    if (input.type === 'email') return 'email';
    if (input.type !== 'text') return undefined;
    const hint = `${input.getAttribute('aria-label') ?? ''} ${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
    if (/e-?mail/.test(hint)) return 'email';
    if (/user|login|account/.test(hint)) return 'username';
    return undefined;
  };
  const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter((input) => {
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return semanticFor(input) !== undefined && !input.disabled && !input.readOnly && !input.hidden
      && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
      && rect.width > 0 && rect.height > 0;
  });

  return new Promise((resolve) => {
    const outlines = new Map<HTMLInputElement, string>();
    const cleanup = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      for (const [input, outline] of outlines) input.style.outline = outline;
      if (page[pickerKey]?.cancel === cancel) delete page[pickerKey];
    };
    const finish = (result: DiscoveredPageField | null) => { cleanup(); resolve(result); };
    const cancel = () => finish(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    const onClick = (event: MouseEvent) => {
      const input = event.composedPath().find((node): node is HTMLInputElement => node instanceof HTMLInputElement);
      if (input === undefined || !candidates.includes(input)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const semantic = semanticFor(input)!;
      let targetId = Array.from(registry.targets).find(([, element]) => element === input)?.[0];
      if (targetId === undefined) {
        targetId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        registry.targets.set(targetId, input);
      }
      const label = input.getAttribute('aria-label')?.trim()
        || Array.from(input.labels ?? []).map((item) => item.textContent?.trim()).filter(Boolean).join(' ')
        || input.placeholder.trim() || input.name || input.id
        || `${semantic[0]!.toUpperCase()}${semantic.slice(1)} field`;
      finish({ targetId, origin: window.location.origin, navigationId: registry.navigationId, semantic, label,
        autocomplete: input.autocomplete, inputType: input.type, name: input.name, elementId: input.id });
    };
    page[pickerKey] = { cancel };
    for (const input of candidates) {
      outlines.set(input, input.style.outline);
      input.style.outline = '2px solid #7857ff';
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

/** Cancels an active picker in the same document/frame. */
export function cancelPageFieldPicker(): boolean {
  type PickerState = { cancel: () => void };
  const page = globalThis as typeof globalThis & { __inheritiElementsPagePickerV1__?: PickerState };
  if (page.__inheritiElementsPagePickerV1__ === undefined) return false;
  page.__inheritiElementsPagePickerV1__.cancel();
  return true;
}
