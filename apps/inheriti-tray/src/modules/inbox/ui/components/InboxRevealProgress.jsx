import { InboxProgressSteps } from './InboxProgressSteps.jsx';

const steps = ['Checking this device', 'Unlocking your message', 'Confirming the one-time read'];

export function InboxRevealProgress() {
  return <InboxProgressSteps label="Opening protected message" steps={steps} />;
}
