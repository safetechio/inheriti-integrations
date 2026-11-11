import {
  Badge,
  Box,
  Button,
  Card,
  FormTextInput,
  Icon,
  IconAction,
  Notice,
  Text,
  theme,
} from '@main-components';
import { useEffect, useRef, useState } from 'react';
import { parserGuidance } from '@modules/import/application/parser-guidance';
import { labels, statusBadge } from './status';
import { KeePassUnlockPopover } from './KeePassUnlockPopover';
import type { ImportFile } from '../types';

type FileRowProps = {
  file: ImportFile;
  initiallyShowUnlock?: boolean;
  onRetry?: (file: ImportFile) => void;
  onUnlock?: (file: ImportFile, password: string, keyFile?: ArrayBuffer) => void;
  onViewWarnings?: (file: ImportFile) => void;
  onRemove?: (file: ImportFile) => void;
};

export function FileRow({
  file,
  initiallyShowUnlock = false,
  onRetry,
  onUnlock,
  onViewWarnings,
  onRemove,
}: FileRowProps) {
  const [password, setPassword] = useState('');
  const [keyFile, setKeyFile] = useState<ArrayBuffer>();
  const keyFileRef = useRef<ArrayBuffer | undefined>(undefined);
  const keyReadRevision = useRef(0);
  const [keyFileName, setKeyFileName] = useState('');
  const [showUnlock, setShowUnlock] = useState(initiallyShowUnlock);
  const [showPassword, setShowPassword] = useState(false);
  const [attemptedUnlock, setAttemptedUnlock] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const unlockTriggerRef = useRef<HTMLElement | null>(null);
  const restoreUnlockFocus = useRef(false);
  useEffect(() => {
    if (file.status === 'unlock-required' || file.status === 'unlocking') return;
    keyReadRevision.current += 1;
    setPassword('');
    if (keyFileRef.current) new Uint8Array(keyFileRef.current).fill(0);
    keyFileRef.current = undefined;
    setKeyFile(undefined);
    setKeyFileName('');
    setShowPassword(false);
    setAttemptedUnlock(false);
  }, [file.status]);
  useEffect(
    () => () => {
      keyReadRevision.current += 1;
      if (keyFileRef.current) new Uint8Array(keyFileRef.current).fill(0);
    },
    [],
  );
  useEffect(() => {
    if (!showUnlock && restoreUnlockFocus.current) {
      unlockTriggerRef.current?.querySelector<HTMLElement>('[role="button"]')?.focus();
      restoreUnlockFocus.current = false;
    }
  }, [showUnlock]);
  const locked = file.status === 'unlock-required' || file.status === 'unlocking';
  const cancelUnlock = (restoreFocus = true) => {
    keyReadRevision.current += 1;
    if (keyFileRef.current) new Uint8Array(keyFileRef.current).fill(0);
    keyFileRef.current = undefined;
    setKeyFile(undefined);
    setKeyFileName('');
    if (keyInputRef.current) keyInputRef.current.value = '';
    setPassword('');
    setShowPassword(false);
    setAttemptedUnlock(false);
    restoreUnlockFocus.current = restoreFocus;
    setShowUnlock(false);
  };
  const canRetry = file.status === 'failed';
  return (
    <Card tone="default" className="source-file-card">
      <Box
        flexDirection="row"
        alignItems="flex-start"
        gap={theme.importer.spacing.sectionGap}
        style={{ flexWrap: 'wrap' }}
      >
        <Icon
          name={
            locked
              ? 'lock'
              : file.format === 'KeePass'
                ? 'database'
                : file.format === 'Vault'
                  ? 'shield'
                  : 'file-lines'
          }
          color={theme.colors[locked ? 'warning120' : 'gray120']}
        />
        <Box gap={2} style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Box flexDirection="row" alignItems="center" gap="s" style={{ flexWrap: 'wrap' }}>
            <Box
              ref={(element) => element?.setAttribute('title', file.name)}
              style={{ maxWidth: '25ch', minWidth: 0 }}
            >
              <Text variant="importerSourceName" numberOfLines={1}>
                {file.name}
              </Text>
            </Box>
            <Badge tone="primary" variant="metadata">
              {file.format}
            </Badge>
          </Box>
          <Text variant="importerSourceMeta" color={locked ? 'warning120' : 'gray'}>
            {file.status === 'failed' || file.status === 'retrying'
              ? 'Not parsed'
              : file.status === 'unlocking'
                ? 'Unlocking database'
                : file.status === 'unlock-required'
                  ? 'Locked database'
                  : `${file.entries ?? 0} entr${file.entries === 1 ? 'y' : 'ies'}`}
          </Text>
          {file.detail && !locked ? (
            <Text variant="bodySmall" color="gray">
              {file.detail}
            </Text>
          ) : null}
        </Box>
        <Box
          className="source-file-actions"
          flexDirection="row"
          alignItems="flex-start"
          gap="s"
          style={{ flexWrap: 'wrap' }}
        >
          {!locked ? (
            <Badge tone={statusBadge[file.status].tone} icon={statusBadge[file.status].icon}>
              {file.status === 'warning'
                ? `${file.warnings ?? 0} warning${file.warnings === 1 ? '' : 's'}`
                : labels[file.status]}
            </Badge>
          ) : null}
          {file.status === 'warning' ? (
            <Button
              title="View warnings"
              startIcon={<Icon name="circle-info" size={11} />}
              variant="outlined"
              size="sm"
              minHeight={theme.importer.controls.sourceActionHeight}
              paddingHorizontal={theme.importer.spacing.sectionGap}
              textVariant="buttonDefault"
              disabled={!onViewWarnings}
              onPress={() => onViewWarnings?.(file)}
            />
          ) : null}
          {locked ? (
            <Box>
              <Box ref={(element) => { unlockTriggerRef.current = element; }}>
                <Button
                  title="Unlock"
                  variant="outlined"
                  size="sm"
                  minHeight={theme.importer.controls.sourceActionHeight}
                  paddingHorizontal={theme.importer.spacing.sectionGap}
                  textVariant="buttonDefault"
                  disabled={showUnlock || file.status === 'unlocking'}
                  onPress={() => setShowUnlock(true)}
                />
              </Box>
              {showUnlock ? (
                <KeePassUnlockPopover
                  triggerRef={unlockTriggerRef}
                  busy={file.status === 'unlocking'}
                  onDismiss={cancelUnlock}
                >
                  <Box gap="xxs" alignItems="flex-start">
                    <Button
                      title="Choose file"
                      variant="outlined"
                      color="gray"
                      size="sm"
                      disabled={file.status === 'unlocking'}
                      onPress={() => keyInputRef.current?.click()}
                    />
                    <input
                      ref={keyInputRef}
                      className="source-unlock-file-input"
                      type="file"
                      tabIndex={-1}
                      aria-label="KeePass key file"
                      disabled={file.status === 'unlocking'}
                      onChange={async (event) => {
                        const selected = event.target.files?.[0];
                        const revision = ++keyReadRevision.current;
                        if (keyFileRef.current) new Uint8Array(keyFileRef.current).fill(0);
                        keyFileRef.current = undefined;
                        setKeyFile(undefined);
                        setKeyFileName('');
                        const bytes = selected ? await selected.arrayBuffer() : undefined;
                        if (revision !== keyReadRevision.current) {
                          if (bytes) new Uint8Array(bytes).fill(0);
                          return;
                        }
                        keyFileRef.current = bytes;
                        setKeyFile(bytes);
                        setKeyFileName(selected?.name ?? '');
                      }}
                    />
                    {keyFileName ? (
                      <Text variant="bodySmall" color="gray" numberOfLines={1}>
                        {keyFileName}
                      </Text>
                    ) : null}
                  </Box>
                  <Box className="source-unlock-password">
                    <FormTextInput
                      label="Master password"
                      editable={file.status !== 'unlocking'}
                      secureTextEntry={!showPassword}
                      error={attemptedUnlock && file.status === 'unlock-required' ? file.detail : undefined}
                      value={password}
                      onChangeText={setPassword}
                      style={{ paddingRight: 44 }}
                    />
                    <Box className="source-unlock-reveal">
                      <IconAction
                        name={showPassword ? 'eye-slash' : 'eye'}
                        label={showPassword ? 'Hide password' : 'Show password'}
                        disabled={file.status === 'unlocking'}
                        onPress={() => setShowPassword((value) => !value)}
                      />
                    </Box>
                  </Box>
                  <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                    <Button
                      title="Cancel"
                      variant="plain"
                      color="gray"
                      disabled={file.status === 'unlocking'}
                      onPress={() => cancelUnlock()}
                    />
                    <Button
                      title="Unlock"
                      disabled={
                        file.status === 'unlocking' ||
                        !onUnlock ||
                        (password.length === 0 && !keyFile)
                      }
                      onPress={() => {
                        setAttemptedUnlock(true);
                        onUnlock?.(file, password, keyFile);
                      }}
                    />
                  </Box>
                </KeePassUnlockPopover>
              ) : null}
            </Box>
          ) : null}
          {canRetry ? (
            <Button
              title="Retry"
              startIcon={<Icon name="rotate" size={11} color={theme.colors.danger120} />}
              variant="outlined"
              color="danger"
              size="sm"
              minHeight={theme.importer.controls.sourceActionHeight}
              paddingHorizontal={theme.importer.spacing.sectionGap}
              textVariant="buttonDefault"
              disabled={!onRetry}
              onPress={() => onRetry?.(file)}
            />
          ) : null}
          {onRemove ? (
            <Button
              title="Remove"
              variant="plain"
              color="danger"
              size="sm"
              disabled={file.status === 'unlocking'}
              onPress={() => onRemove(file)}
            />
          ) : null}
        </Box>
      </Box>
      {file.status === 'failed' ? (
        <Notice
          compact
          tone="danger"
          icon="circle-exclamation"
          title="This source could not be parsed."
          description={
            parserGuidance(file.detail ?? '') ??
            file.detail ??
            'Check the exported file and retry. Nothing from this source was added.'
          }
        />
      ) : null}
    </Card>
  );
}
