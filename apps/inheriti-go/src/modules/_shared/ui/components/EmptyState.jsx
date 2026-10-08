import { PlusIcon } from './Icons.jsx';

export function EmptyState({ title, description, actionLabel, onAction }) {
  return <div className="tray-empty-state" role="status">
    <div className="tray-empty-illustration" aria-hidden="true">
      <span className="tray-empty-illustration-icon"><PlusIcon /></span>
      <span className="tray-empty-illustration-line" />
      <span className="tray-empty-illustration-line short" />
    </div>
    <h2>{title}</h2>
    <p>{description}</p>
    {actionLabel && onAction && <button className="button-secondary" type="button" onClick={onAction}>{actionLabel}</button>}
  </div>;
}
