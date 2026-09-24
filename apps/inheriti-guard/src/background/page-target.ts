export type PageTargetWriteResult =
  | 'filled'
  | 'stale-page-context'
  | 'field-unavailable'
  | 'invalid-value';

/** Inject into the target frame immediately before an authorized delivery. */
export function revalidatePageTarget(
  targetId: string,
  expectedOrigin: string,
  expectedNavigationId: string,
): boolean {
  type Registry = { navigationId: string; href: string; targets: Map<string, HTMLInputElement> };
  const registry = (globalThis as typeof globalThis & {
    __inheritiPageTargetsV1__?: Registry;
  }).__inheritiPageTargetsV1__;
  const input = registry?.targets.get(targetId);
  if (window.location.origin !== expectedOrigin || registry?.navigationId !== expectedNavigationId
    || registry.href !== window.location.href) return false;
  if (input === undefined || !input.isConnected || input.disabled || input.readOnly || input.hidden) return false;
  const style = window.getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
    && rect.width > 0 && rect.height > 0;
}

/** Write-only delivery to an opaque target. This function never reads the field's current value. */
export function writePageTarget(
  targetId: string,
  expectedOrigin: string,
  expectedNavigationId: string,
  protectedValue: string,
): PageTargetWriteResult {
  type Registry = { navigationId: string; href: string; targets: Map<string, HTMLInputElement> };
  const registry = (globalThis as typeof globalThis & {
    __inheritiPageTargetsV1__?: Registry;
  }).__inheritiPageTargetsV1__;
  if (window.location.origin !== expectedOrigin || registry?.navigationId !== expectedNavigationId
    || registry.href !== window.location.href) {
    return 'stale-page-context';
  }
  const input = registry.targets.get(targetId);
  if (input === undefined || !input.isConnected || input.disabled || input.readOnly || input.hidden) {
    return 'field-unavailable';
  }
  if (typeof protectedValue !== 'string') return 'invalid-value';
  const style = window.getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
    || rect.width <= 0 || rect.height <= 0) return 'field-unavailable';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) return 'field-unavailable';
  setter.call(input, protectedValue);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'filled';
}
