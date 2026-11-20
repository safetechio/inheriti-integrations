import { useEffect, useState } from 'react';
import { Box, Text } from '@main-components';
import './styles.css';

export function FolderPendingStatus({
  active,
  label,
  immediate = false,
  showIndicator = true,
}: {
  active: boolean;
  label: string;
  immediate?: boolean;
  showIndicator?: boolean;
}) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active || immediate) return;
    const timeout = setTimeout(() => setElapsed(true), 250);
    return () => {
      clearTimeout(timeout);
      setElapsed(false);
    };
  }, [active, immediate]);

  const visible = active && (immediate || elapsed);
  return (
    <Box role="status" position={visible && showIndicator ? undefined : 'absolute'}>
      {visible ? (
        <>
          <Text className="folder-pending-label">{label}</Text>
          {showIndicator ? (
            <Box className="folder-pending-dots" alignItems="center" justifyContent="center" aria-hidden>
              <Box className="folder-pending-dot" backgroundColor="gray" />
              <Box className="folder-pending-dot" backgroundColor="gray" />
              <Box className="folder-pending-dot" backgroundColor="gray" />
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
