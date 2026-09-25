export type PageTargetCheckResult = 'ready' | 'page-address-changed' | 'form-changed' | 'field-unavailable';

export type PageTargetWriteResult =
  | 'filled'
  | 'page-address-changed'
  | 'form-changed'
  | 'field-unavailable'
  | 'invalid-value';

/** Inject into the target frame immediately before an authorized delivery. */
export function revalidatePageTarget(
  targetId: string,
  expectedOrigin: string,
  expectedNavigationId: string,
): PageTargetCheckResult {
  type Registry = { navigationId: string; href: string; targets: Map<string, HTMLInputElement> };
  const registry = (globalThis as typeof globalThis & {
    __inheritiPageTargetsV1__?: Registry;
  }).__inheritiPageTargetsV1__;
  const input = registry?.targets.get(targetId);
  if (registry === undefined) return 'form-changed';
  if (window.location.origin !== expectedOrigin || registry.href !== window.location.href) return 'page-address-changed';
  if (registry.navigationId !== expectedNavigationId || input === undefined || !input.isConnected) return 'form-changed';
  if (input.disabled || input.readOnly || input.hidden) return 'field-unavailable';
  const style = window.getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
    && rect.width > 0 && rect.height > 0 ? 'ready' : 'field-unavailable';
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
  if (registry === undefined) return 'form-changed';
  if (window.location.origin !== expectedOrigin || registry.href !== window.location.href) return 'page-address-changed';
  if (registry.navigationId !== expectedNavigationId) return 'form-changed';
  const input = registry.targets.get(targetId);
  if (input === undefined || !input.isConnected) return 'form-changed';
  if (input.disabled || input.readOnly || input.hidden) return 'field-unavailable';
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
