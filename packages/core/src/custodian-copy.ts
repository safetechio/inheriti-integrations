export const custodianShareCopy = {
  choice: {
    title: 'Choose a custodian device',
    question: 'Where should this plan share be stored?',
    intro: 'Save the current custodian share on a device to use for plan access. After editing the plan, claim the new share again.',
    mobileOption: 'SafeKey Mobile',
    mobileDescription: 'A request to claim this plan share will be sent to your SafeKey Mobile.',
    proOption: 'SafeKey PRO',
    proDescription: 'Connect your SafeKey PRO cold device to write this plan share.',
    proConnect: 'Connect your SafeKey PRO to this computer to continue.',
    proTouch: 'Press and release the SafeKey PRO touch button when prompted.',
  },
  firstAccess: {
    mobileClaim: 'Open SafeKey Mobile to claim the current plan share on your phone for plan access. After editing the plan, claim the new share again.',
    mobileClaimPending: 'Open SafeKey Mobile to claim the current plan share, then release it for this access. After editing the plan, claim the new share again.',
    proStore: 'Store the custodian share on your connected SafeKey PRO to continue.',
    proPin: 'Enter your PIN to save the custodian share to your device.',
  },
  laterAccess: {
    mobileRelease: 'This plan share is stored on your phone. Open SafeKey Mobile and approve its release for this access.',
    proRead: 'Read the custodian share from your connected SafeKey PRO to continue.',
    proPin: 'Enter your PIN to read the custodian share from your device.',
  },
} as const;
