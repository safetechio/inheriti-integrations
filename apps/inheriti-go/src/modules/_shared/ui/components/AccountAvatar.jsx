export function AccountAvatar({ name, online = false }) {
  const initials = name?.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return <span className={`tray-account-avatar${online ? ' is-online' : ''}`} aria-hidden="true">{initials}</span>;
}
