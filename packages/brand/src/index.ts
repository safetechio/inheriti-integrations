export { planAvatarSvg } from './plan-avatar.js';

export const elementsBrand = Object.freeze({
  productName: 'Inheriti',
  shortName: 'Inheriti',
  status: 'temporary-primitives' as const,
  publishable: false as const,
  colors: Object.freeze({ ink: '#101828', surface: '#FFFFFF', primary: '#2962FF', success: '#22C55E', danger: '#DC3545' }),
});

export const elementsWordmark = Object.freeze({ text: 'INHERITI', publishable: false as const });

/** Canonical product identity for browser surfaces and release metadata. */
export const inheritiGuardBrand = Object.freeze({
  productName: 'InheritiGuard',
  shortName: 'InheritiGuard',
  description: 'Browser Protection and Protection Plan Access',
  colors: Object.freeze({
    ink: '#101828',
    muted: '#535862',
    surface: '#FFFFFF',
    canvas: '#F8FBFF',
    primary: '#0066FF',
    primaryDark: '#1642BA',
    primarySoft: '#E3F2FD',
    success: '#15803D',
    danger: '#B42318',
  }),
});

/** Shared geometry keeps the official shield identical without duplicating binary assets. */
export const inheritiGuardShield = Object.freeze({
  viewBox: '0 0 26 32',
  path: 'M14.2718.2767a4.57 4.57 0 0 0-2.824.0098L2.9978 3.1661A4.427 4.427 0 0 0 0 7.3563v11.5719c0 4.7954 3.1977 10.0393 11.133 12.9002 1.3501.4867 2.6822-.5547 2.6822-1.9167V19.2703l2.5761-3.2186h4.2535a.949.949 0 0 0 0-1.8981h-2.7343l2.6614-3.325a.95.95 0 0 0-.1158-1.3249.899.899 0 0 0-1.2646.1106l-1.598 1.9965V7.6256a.919.919 0 1 0-1.8381 0v6.2817l-1.9402 2.4241V5.4845a.876.876 0 1 0-1.7515 0v11.0708l-2.0598-2.5736V7.6256a.919.919 0 1 0-1.838 0v4.0597L6.5882 9.7142a.9.9 0 0 0-1.2647-.1106.95.95 0 0 0-.1157 1.3249l2.6288 3.2844H5.2901a.919.919 0 1 0 0 1.839h3.9058c.0365 0 .0724-.0021.1077-.0062l2.726 3.4059.0341.0403v10.4198c0 .2224-.1972.3185-.337.2681-7.3962-2.6665-9.9753-7.3477-9.9753-11.2516V7.3563c0-1.1446.7282-2.1623 1.8111-2.5314l8.4499-2.8797a2.68 2.68 0 0 1 1.7062-.0059l8.7004 2.8983a2.676 2.676 0 0 1 1.8285 2.5373v11.6109l.0007.166c-.0031.4667-.1879 5.4907-7.8423 9.756a.876.876 0 1 0 .8523 1.5309c8.2907-4.6199 8.7349-10.2808 8.7414-11.2756l-.0011-.1773V7.3749a4.426 4.426 0 0 0-3.0267-4.1999L14.2718.2767Z',
});

export function terminalWordmark(options: { noColor?: boolean } = {}): string {
  const text = elementsWordmark.text;
  return options.noColor ? text : `\u001b[38;2;41;98;255m${text}\u001b[0m`;
}

/** CLI adapters pass `process.env.NO_COLOR !== undefined`; browser/native callers pass true or false directly. */
export function noColorFromEnvironment(environment: Readonly<Record<string, string | undefined>>): boolean {
  return environment.NO_COLOR !== undefined;
}
