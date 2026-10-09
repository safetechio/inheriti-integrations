export function InboxPresenceDot({ status }) {
  if (status !== 'Online' && status !== 'Offline') return null;
  return <span className={`inbox-presence-dot${status === 'Online' ? ' is-online' : ''}`} role="img" aria-label={status} title={status} />;
}
