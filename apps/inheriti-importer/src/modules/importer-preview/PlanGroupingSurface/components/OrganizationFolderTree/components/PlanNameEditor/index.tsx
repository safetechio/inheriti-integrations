import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Box, Text } from '@main-components';

export function PlanNameEditor({ initialName, onFinish }: {
  initialName: string;
  onFinish: (name: string | undefined, reason: 'keyboard' | 'blur') => void;
}) {
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState('');
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  const finish = (name: string | undefined, reason: 'keyboard' | 'blur') => {
    if (finished.current) return;
    finished.current = true;
    onFinish(name, reason);
  };

  const save = (reason: 'keyboard' | 'blur') => {
    const name = draft.trim();
    if (!name) setError('Enter a plan name.');
    else if (name.length > 160) setError('Plan name must be 160 characters or fewer.');
    else finish(name, reason);
  };

  return (
    <Box className="folder-plan-name-editor" gap="xxs">
      <input
        ref={input}
        aria-label="Plan name"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        onBlur={() => save('blur')}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          setDraft(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Enter') save('keyboard');
            else finish(undefined, 'keyboard');
          }
        }}
      />
      {error ? <Text nativeID={errorId} accessibilityRole="alert" color="danger120" variant="xSmall">{error}</Text> : null}
    </Box>
  );
}
