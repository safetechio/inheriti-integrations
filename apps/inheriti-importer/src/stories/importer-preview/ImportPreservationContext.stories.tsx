import { useState } from 'react';
import { ShellFixture } from './shell-fixtures';
import { PreservationContext } from './preservation-context/PreservationContext';

export const EncryptedStaging = () => {
  const [run, setRun] = useState(0);
  return (
    <ShellFixture>
      <PreservationContext key={run} onReset={() => setRun((current) => current + 1)} />
    </ShellFixture>
  );
};
EncryptedStaging.meta = { iframed: true };
