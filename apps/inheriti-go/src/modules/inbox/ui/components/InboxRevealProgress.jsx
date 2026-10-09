export function InboxRevealProgress({ progress, showBar = true }) {
  return <div className="inbox-unit-progress" role="status" aria-live="polite">
    <strong key={progress ? `${progress.current}/${progress.total}` : 'opening'}>{progress ? `Opening ${progress.remaining ? 'remaining ' : ''}secret ${progress.current} of ${progress.total}` : 'Opening protected message…'}</strong>
    {showBar && <span className="inbox-progress-track is-indeterminate" aria-hidden="true"><span /></span>}
  </div>;
}
