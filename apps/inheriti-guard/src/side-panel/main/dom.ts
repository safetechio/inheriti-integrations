import type { AccessFieldResult, AccessFieldSuggestion } from '../../shared/access-contract.js';

export function errorText(error: string): string {
  if (error === 'no-active-tab') return 'Open Access from a supported web page.';
  if (error === 'stale-tab-context' || error === 'stale-page-context') return 'The page changed. Reopen Access and try again.';
  if (error === 'invalid-access-batch') return 'The mappings are no longer valid. Review them and try again.';
  if (error === 'plan-request-failed') return 'The plan could not be loaded. Check your session and try again.';
  return 'The access request could not be completed.';
}
export function resultLabel(code: AccessFieldResult['code']): string {
  return ({ filled: 'Autofilled', 'authorization-denied': 'Not allowed on this site', 'field-unavailable': 'Input unavailable', 'invalid-value': 'Value not compatible', 'stale-page-context': 'Page changed', 'page-address-changed': 'Address changed', 'form-changed': 'Form replaced', 'tab-inactive': 'Tab changed', 'destination-failed': 'Could not autofill', canceled: 'Canceled', 'not-attempted': 'Not attempted' })[code];
}
export function suggestionReason(reason: AccessFieldSuggestion['reason']): string {
  return ({ 'exact-origin': 'exact origin match', autocomplete: 'autocomplete match', 'input-type': 'input type match', 'accessible-label': 'accessible label match', name: 'field name match', id: 'field id match', 'inferred-semantic': 'inferred field type' })[reason];
}
export function remainingGate(deadline: string): string {
  const seconds = Math.ceil(Math.max(0, new Date(deadline).getTime() - Date.now()) / 1_000);
  return `Time remaining ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.`;
}
export function minutesUntil(deadline: string): string {
  const minutes = Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function titleCase(value: string): string {
  return value.toLocaleLowerCase().replace(/(^|[_\s-])([a-z])/gu, (_match, separator: string, letter: string) => `${separator === '_' ? ' ' : separator}${letter.toLocaleUpperCase()}`);
}
export function actionButton(label: string, kind: 'primary' | 'secondary'): HTMLButtonElement {
  const button = compactButton(label);
  button.className = `button ${kind} plan-action`;
  return button;
}
export function compactButton(label: string, kind = ''): HTMLButtonElement {
  const button = el('button', `compact-button ${kind}`.trim(), label);
  button.type = 'button';
  return button;
}
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing side-panel element: ${id}`);
  return node as T;
}
