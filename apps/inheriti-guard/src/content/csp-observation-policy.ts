/** Synthetic page events are not browser CSP evidence and must never reach the extension runtime. */
export function shouldReportCspViolation(protectionEnabled: boolean, event: Pick<Event, 'isTrusted'>): boolean {
  return protectionEnabled && event.isTrusted;
}
