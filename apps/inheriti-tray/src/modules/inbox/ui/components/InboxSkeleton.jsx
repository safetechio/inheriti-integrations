export function InboxSkeleton({ label, kind }) {
  return <div className={`inbox-skeleton inbox-skeleton-${kind}`} role="status">
    <span className="sr-only">{label}</span>
    {[0, 1, 2].map((index) => <div className="inbox-skeleton-row" aria-hidden="true" key={index}>
      <span className="inbox-skeleton-avatar" />
      <span className="inbox-skeleton-lines"><span /><span /></span>
    </div>)}
  </div>;
}
