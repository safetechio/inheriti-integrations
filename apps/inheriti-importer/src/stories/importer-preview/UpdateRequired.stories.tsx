import { UpdateRequiredScreen } from '@modules/_shared/ui/components/UpdateStatus';

const noop = () => undefined;

export const Checking = () => <UpdateRequiredScreen phase="checking" />;
export const Required = () => (
  <UpdateRequiredScreen phase="required" version="0.1.17-dev.0" onInstall={noop} />
);
export const Installing = () => <UpdateRequiredScreen phase="installing" version="0.1.17-dev.0" />;
export const InstallationFailed = () => (
  <UpdateRequiredScreen
    phase="error"
    version="0.1.17-dev.0"
    message="Could not install or verify the update. Retry to continue."
    onRetry={noop}
  />
);
export const CheckFailed = () => (
  <UpdateRequiredScreen
    phase="error"
    message="Could not check for updates. Check your connection and retry."
    onRetry={noop}
  />
);
export const Finishing = () => (
  <UpdateRequiredScreen phase="finishing" version="0.1.17-dev.0" onReopen={noop} />
);
