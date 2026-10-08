import { InboxProgressSteps } from './InboxProgressSteps.jsx';

const steps = ['Checking this computer', 'Unlocking your message', 'Confirming the one-time read'];

export function InboxRevealProgress() {
  return <InboxProgressSteps label="Opening protected message" steps={steps} />;
}
