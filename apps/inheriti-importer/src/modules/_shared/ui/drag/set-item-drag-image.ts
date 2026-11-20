import { theme } from '../theme/AppTheme';

export function setItemDragImage(dataTransfer: DataTransfer, source: HTMLElement, name: string, count: number, countLabel: string, iconSelector = '.plan-mosaic'): void {
  const preview = document.createElement('div');
  preview.dataset.testid = 'item-drag-preview';
  preview.setAttribute('aria-hidden', 'true');
  Object.assign(preview.style, { position: 'fixed', left: '-10000px', top: '0', width: '300px', padding: `${theme.spacing.s}px`, pointerEvents: 'none', fontFamily: theme.textVariants.bodySmall.fontFamily });
  const card = () => {
    const element = document.createElement('div');
    Object.assign(element.style, { border: `1px solid ${theme.colors.gray10}`, borderRadius: `${theme.radii.s}px`, background: theme.colors.white, boxSizing: 'border-box' });
    return element;
  };
  for (let index = Math.min(count, 3) - 1; index > 0; index--) {
    const sheet = card();
    sheet.dataset.dragLayer = String(index);
    Object.assign(sheet.style, { position: 'absolute', left: `${theme.spacing.s + index * 4}px`, top: `${theme.spacing.s + index * 4}px`, width: '284px', height: '60px' });
    preview.append(sheet);
  }
  const front = card();
  Object.assign(front.style, { position: 'relative', display: 'flex', alignItems: 'center', gap: `${theme.spacing.s}px`, minHeight: '60px', padding: `${theme.spacing.s}px ${theme.spacing.m}px`, boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)' });
  const icon = source.querySelector(iconSelector)?.cloneNode(true) as HTMLElement | undefined;
  if (icon) { icon.removeAttribute('aria-label'); icon.style.flexShrink = '0'; front.append(icon); }
  const title = document.createElement('span');
  title.textContent = name;
  Object.assign(title.style, { color: theme.colors.gray120, fontSize: '14px', fontWeight: '600', flex: '1', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
  front.append(title);
  if (count > 1) {
    const badge = document.createElement('span');
    badge.textContent = countLabel;
    Object.assign(badge.style, { color: theme.colors.primary, background: theme.colors.primary10, borderRadius: `${theme.radii.s}px`, fontSize: '12px', whiteSpace: 'nowrap', padding: `${theme.spacing.xs}px ${theme.spacing.s}px` });
    front.append(badge);
  }
  preview.append(front);
  document.body.append(preview);
  dataTransfer.effectAllowed = 'move';
  try { dataTransfer.setDragImage?.(preview, 24, 24); }
  finally { requestAnimationFrame(() => preview.remove()); }
}
