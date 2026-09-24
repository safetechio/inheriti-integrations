export const custodianShareCopy = {
  choice: {
    title: 'Choose a custodian device',
    question: 'Where should this plan share be stored?',
    intro: 'This is your first access to this plan. Save its custodian share to a device now. Future access will require the same device to provide it.',
    mobileOption: 'SafeKey Mobile',
    mobileDescription: 'A request to claim this plan share will be sent to your SafeKey Mobile.',
    proOption: 'SafeKey PRO',
    proDescription: 'Connect your SafeKey PRO cold device to write this plan share.',
    proConnect: 'Connect your SafeKey PRO to this computer to continue.',
    proTouch: 'Press and release the SafeKey PRO touch button when prompted.',
  },
  firstAccess: {
    mobileClaim: 'Open SafeKey Mobile to claim this plan share on your phone. Future access will require that phone to release it.',
    mobileClaimPending: 'This plan share has not been saved to your phone yet. Open SafeKey Mobile to claim it, then release it for this access. Future access will require this phone.',
    proStore: 'Store the custodian share on your connected SafeKey PRO to continue.',
    proPin: 'Enter your PIN to save the custodian share to your device.',
  },
  laterAccess: {
    mobileRelease: 'This plan share is stored on your phone. Open SafeKey Mobile and approve its release for this access.',
    proRead: 'Read the custodian share from your connected SafeKey PRO to continue.',
    proPin: 'Enter your PIN to read the custodian share from your device.',
  },
} as const;
