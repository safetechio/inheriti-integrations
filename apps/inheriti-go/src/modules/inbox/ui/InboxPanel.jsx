import { InboxSetup } from './components/InboxSetup.jsx';
import { InboxReadyPanel } from './components/InboxReadyPanel.jsx';

export function InboxPanel({ onClose, identity, organizationId, targetConversation, onCreatePlanFromSecret, onCreatePlanFromFile }) {
  if (!organizationId || identity.state?.status !== 'ready') return <InboxSetup onClose={onClose}
    onRetry={() => void identity.prepare()} onReplace={() => void identity.replace()} organizationSelected={!!organizationId} state={identity.state} error={identity.error} />;
  return <InboxReadyPanel onClose={onClose} identity={identity.state} organizationId={organizationId} targetConversation={targetConversation} onCreatePlanFromSecret={onCreatePlanFromSecret} onCreatePlanFromFile={onCreatePlanFromFile} />;
}
