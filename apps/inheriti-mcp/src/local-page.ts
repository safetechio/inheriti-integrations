import { readFileSync } from 'node:fs';

const image = (name: string) => `data:image/png;base64,${readFileSync(new URL(`./assets/${name}.png`, import.meta.url)).toString('base64')}`;
export const logo = image('inheriti-business-logo');
export const pro = image('safekey-pro');
export const mobile = image('safekey-mobile');
const font = `data:font/ttf;base64,${readFileSync(new URL('./assets/font-app.ttf', import.meta.url)).toString('base64')}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function renderTemplate(name: string, values: Record<string, string> = {}) {
  const template = readFileSync(new URL(`./templates/${name}.html`, import.meta.url), 'utf8');
  return template.replace(/{{(\w+)}}/g, (_, key: string) => values[key] ?? '');
}

export function brandPage(title: string, content: string, options: { eyebrow?: string; footer?: string; refresh?: boolean } = {}) {
  return renderTemplate('page', { title: escapeHtml(title), refresh: options.refresh ? renderTemplate('refresh') : '', font, logo,
    eyebrow: escapeHtml(options.eyebrow ?? 'Local approval'), content,
    footer: escapeHtml(options.footer ?? 'This request stays on your device. Keep this page open until it completes.') });
}
