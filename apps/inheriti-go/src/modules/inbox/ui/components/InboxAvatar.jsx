import { useState } from 'react';
import { initials } from '../utils/inboxDisplay.js';

export function InboxAvatar({ name, url, className = 'inbox-avatar' }) {
  const [failedUrl, setFailedUrl] = useState('');
  let photo;
  try { if (new URL(url).protocol === 'https:') photo = url; } catch { /* No signed photo. */ }
  return <span className={className} aria-hidden="true">{photo && failedUrl !== photo
    ? <img src={photo} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailedUrl(photo)} />
    : initials(name || 'M')}</span>;
}
