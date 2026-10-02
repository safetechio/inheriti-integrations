import { useInboxPanel } from '../hooks/useInboxPanel.js';
import { useInboxNavigation } from '../hooks/useInboxNavigation.js';
import { InboxMemberPicker } from './InboxMemberPicker.jsx';
import { InboxConversationList } from './InboxConversationList.jsx';
import { InboxMessageList } from './InboxMessageList.jsx';
import { InboxConversationMembers } from './InboxConversationMembers.jsx';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../../../_shared/ui/components/Icons.jsx';
import { conversationMemberNames, conversationTitle } from '../utils/inboxDisplay.js';

export function InboxReadyPanel({ onClose, identity }) {
  const inbox = useInboxPanel(onClose, identity);
  const navigation = useInboxNavigation(inbox);
  const { screen, showMembers } = navigation;
  const conversation = inbox.conversations.items.find((item) => item.id === inbox.messages.conversationId);
  const memberNames = conversationMemberNames(conversation, inbox.participants.names, inbox.identity?.memberId);
  const title = conversation?.title || conversationTitle(memberNames);

  return <main className="tray-screen inbox-panel">
    <header className="tray-screen-header tray-screen-heading inbox-header">
      <button className="tray-back" type="button" aria-label={screen === 'list' ? 'Close Secure Inbox' : 'Back to conversations'} onClick={screen === 'list' ? onClose : navigation.goBack}><ChevronLeftIcon /></button>
      {screen === 'thread' ? <button type="button" className="inbox-thread-title" onClick={navigation.openMembers} aria-label={`Participants in ${title}`}>
        <strong>{title}</strong><small>{conversation?.participantMemberIds.length || 0} members · End-to-end encrypted</small>
      </button> : <h1>{screen === 'new' ? 'New conversation' : 'Secure Inbox'}</h1>}
      {screen === 'list' && <button type="button" className="inbox-new-button" onClick={navigation.startConversation}><PlusIcon /> New</button>}
      {screen === 'new' && <small>{inbox.participants.memberIds.length + 1} of 50</small>}
      {screen === 'thread' && <button type="button" className="tray-back" aria-label="Show participants" onClick={navigation.openMembers}><ChevronRightIcon /></button>}
    </header>
    {inbox.error && <p className="inbox-error error" role="alert">{inbox.error}</p>}
    {inbox.toast && <div className="inbox-toast" role="status"><span aria-hidden="true" className="inbox-toast-dot" />{inbox.toast.message}</div>}
    {screen === 'list' && <div className="tray-scroll inbox-list-screen">
      <div className="inbox-device-notice"><span className="inbox-lock" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg></span><div><strong>This device is ready</strong><small>Messages are sealed here and open once per member.</small></div></div>
      <InboxConversationList conversations={inbox.conversations.items} conversationId={inbox.messages.conversationId}
        names={inbox.participants.names} ownMemberId={inbox.identity?.memberId} busy={inbox.conversations.busy}
        onRefresh={inbox.conversations.refresh} onSelect={navigation.openConversation} />
    </div>}
    {screen === 'new' && <InboxMemberPicker title={inbox.title} setTitle={inbox.setTitle} query={inbox.participants.query} setQuery={inbox.participants.setQuery}
      onSearch={inbox.participants.search} participants={inbox.participants.items}
      memberIds={inbox.participants.memberIds} onToggle={inbox.participants.toggleMemberId}
      onClear={() => inbox.participants.setMemberIds([])} searchBusy={inbox.participants.busy}
      onCreate={navigation.createConversation} busy={inbox.busy} names={inbox.participants.names} />}
    {screen === 'thread' && <InboxMessageList conversationId={inbox.messages.conversationId}
      messages={inbox.messages.items} names={inbox.participants.names} ownMemberId={inbox.identity?.memberId}
      revealed={inbox.messages.revealed} revealSeconds={inbox.messages.revealSeconds} openingMessageId={inbox.messages.openingMessageId}
      onHide={inbox.messages.hide} onRetryAck={inbox.messages.retryAck}
      onRefresh={inbox.messages.select} onView={inbox.messages.view} onSend={inbox.messages.send}
      onSendFile={inbox.messages.sendFile} onSaveFile={inbox.messages.saveFile}
      onCancelTransfer={inbox.messages.cancelTransfer} transfer={inbox.messages.transfer}
      draft={inbox.messages.draft} setDraft={inbox.messages.setDraft} busy={inbox.messages.busy} />}
    {screen === 'thread' && showMembers && conversation && <div className="inbox-sheet" role="dialog" aria-modal="true" aria-label="Participants">
      <button type="button" className="inbox-sheet-backdrop" aria-label="Close participants" onClick={navigation.closeMembers} />
      <div className="inbox-sheet-body"><div className="inbox-sheet-header"><h2>Participants</h2><button ref={navigation.sheetDone} type="button" className="inbox-link" onClick={navigation.closeMembers}>Done</button></div>
        <InboxConversationMembers conversation={conversation} ownMemberId={inbox.identity?.memberId}
          participants={inbox.participants} names={inbox.participants.names} busy={inbox.busy} onChange={inbox.conversations.change} />
      </div>
    </div>}
  </main>;
}
