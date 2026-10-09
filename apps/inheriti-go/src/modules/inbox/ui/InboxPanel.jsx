import { useInboxState } from './useInboxState.js';
import { InboxSetup } from './components/InboxSetup.jsx';
import { InboxReadyPanel } from './components/InboxReadyPanel.jsx';

export function InboxPanel({ onClose, organizationSelected, organizationId, targetConversation, onCreatePlanFromSecret, onCreatePlanFromFile }) {
  const identity = useInboxState(organizationSelected);
  async function leaveSetup() { try { await window.inheritiTray.inboxCancelPreparation(); } finally { onClose(); } }
  if (!organizationSelected || identity.state?.status !== 'ready') return <InboxSetup onClose={() => void leaveSetup()}
    onRetry={() => void identity.prepare()} onReplace={() => void identity.replace()} organizationSelected={organizationSelected} state={identity.state} error={identity.error} />;
  return <InboxReadyPanel onClose={onClose} identity={identity.state} organizationId={organizationId} targetConversation={targetConversation} onCreatePlanFromSecret={onCreatePlanFromSecret} onCreatePlanFromFile={onCreatePlanFromFile} />;
}
