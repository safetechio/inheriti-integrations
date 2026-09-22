import { inheritiGuardBrand, inheritiGuardShield } from '@safetech/inheriti-elements-brand';

document.documentElement.style.setProperty('--brand-primary', inheritiGuardBrand.colors.primary);
document.getElementById('shield-path')!.setAttribute('d', inheritiGuardShield.path);

const location = document.getElementById('blocked-location')!;
const rawUrl = new URLSearchParams(window.location.search).get('url');
if (rawUrl !== null) {
  try {
    const blocked = new URL(rawUrl);
    location.textContent = `${blocked.origin}${blocked.pathname}`;
    location.hidden = false;
  } catch { /* Invalid input stays unrendered. */ }
}

document.getElementById('go-back')!.addEventListener('click', () => { history.back(); });
document.getElementById('close-tab')!.addEventListener('click', () => { void chrome.tabs.getCurrent().then((tab) => tab?.id === undefined ? undefined : chrome.tabs.remove(tab.id)); });
