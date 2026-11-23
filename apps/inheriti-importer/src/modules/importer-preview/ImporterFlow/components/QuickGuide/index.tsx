import { useEffect, useRef, useState } from 'react';
import { Button, Icon, theme } from '@main-components';
import type { GuideStage } from './content';
import { GuideModal } from './components/GuideModal';
import { rememberGuideDismissal, wasGuideDismissed } from './hooks/guide-visit';
import './styles.css';

export function QuickGuide({
  stage,
  disabled,
  autoOpen = false,
}: {
  stage: GuideStage;
  disabled?: boolean;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (autoOpen && !disabled && !wasGuideDismissed(stage)) setOpen(true);
  }, [autoOpen, disabled, stage]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dismiss = () => {
    if (closing) return;
    rememberGuideDismissal(stage);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setOpen(false);
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 160);
  };

  return (
    <>
      <Button
        title="Quick guide"
        variant="plain"
        size="sm"
        disabled={disabled}
        startIcon={
          <Icon
            name="book-open"
            size={12}
            color={disabled ? theme.colors.primary30 : theme.colors.primary120}
          />
        }
        onPress={() => setOpen(true)}
      />
      {open && !disabled ? (
        <GuideModal stage={stage} closing={closing} onDismiss={dismiss} />
      ) : null}
    </>
  );
}
