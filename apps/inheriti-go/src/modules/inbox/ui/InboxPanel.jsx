import { InboxSetup } from './components/InboxSetup.jsx';
import { InboxReadyPanel } from './components/InboxReadyPanel.jsx';
import { useInboxAccess } from './useInboxAccess.js';

export function InboxPanel({ onClose, identity, organizationId, targetConversation, onCreatePlanFromSecret, onCreatePlanFromFile }) {
  const access = useInboxAccess(identity.state?.status === 'ready' ? organizationId : undefined);
  if (!organizationId || identity.state?.status !== 'ready') return <InboxSetup onClose={onClose}
    onRetry={() => void identity.prepare()} onReplace={() => void identity.replace()} organizationSelected={!!organizationId} state={identity.state} error={identity.error} />;
  if (access.status !== 'ready') return <InboxSetup onClose={onClose} onRetry={() => void access.retry()}
    organizationSelected state={{ status: access.status === 'error' ? 'error' : 'preparing', message: access.status === 'error' ? access.error : 'Checking organisation key. Approve the request in SafeKey Mobile if prompted.' }}
    mode="access" />;
  return <InboxReadyPanel onClose={onClose} identity={identity.state} organizationId={organizationId} targetConversation={targetConversation} onCreatePlanFromSecret={onCreatePlanFromSecret} onCreatePlanFromFile={onCreatePlanFromFile} />;
}
