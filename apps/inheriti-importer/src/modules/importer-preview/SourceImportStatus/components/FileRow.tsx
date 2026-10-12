import {
  Badge,
  Box,
  Button,
  Card,
  FormTextInput,
  Icon,
  Notice,
  Text,
  theme,
} from '@main-components';
import { useState } from 'react';
import { parserGuidance } from '@modules/import/application/parser-guidance';
import { labels, statusBadge } from './status';
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
  const [keyFileName, setKeyFileName] = useState('');
  const [showUnlock, setShowUnlock] = useState(initiallyShowUnlock);
  const canRetry = file.status === 'failed';
  return (
    <Card tone="default" className="source-file-card">
      <Box
        flexDirection="row"
        alignItems="center"
        gap={theme.importer.spacing.sectionGap}
        style={{ flexWrap: 'wrap' }}
      >
        <Icon
          name={
            file.format === 'KeePass'
              ? 'database'
              : file.format === 'Vault'
                ? 'shield'
                : 'file-lines'
          }
          color={statusHex[file.status]}
        />
        <Box gap={2} style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Box flexDirection="row" alignItems="center" gap="s" style={{ flexWrap: 'wrap' }}>
            <Text variant="importerSourceName">{file.name}</Text>
            <Badge tone="primary" variant="metadata">
              {file.format}
            </Badge>
          </Box>
          <Text variant="importerSourceMeta" color="gray">
            {file.status === 'failed' || file.status === 'retrying'
              ? 'Not parsed'
              : file.status === 'unlock-required'
                ? 'Locked database · entries unknown'
                : `${file.entries} entries · ${file.warnings} warnings`}
          </Text>
          {file.detail ? (
            <Text variant="bodySmall" color="gray">
              {file.detail}
            </Text>
          ) : null}
        </Box>
        <Box flexDirection="row" alignItems="center" gap="s" style={{ flexWrap: 'wrap' }}>
          <Badge tone={statusBadge[file.status].tone} icon={statusBadge[file.status].icon}>
            {file.status === 'warning' ? `${file.warnings ?? 0} warnings` : labels[file.status]}
          </Badge>
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
          {file.status === 'unlock-required' ? (
            <Button
              title="Unlock"
              startIcon={<Icon name="unlock" size={11} />}
              variant="outlined"
              size="sm"
              minHeight={theme.importer.controls.sourceActionHeight}
              paddingHorizontal={theme.importer.spacing.sectionGap}
              textVariant="buttonDefault"
              onPress={() => setShowUnlock(true)}
            />
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
              onPress={() => onRemove(file)}
            />
          ) : null}
        </Box>
      </Box>
      {file.status === 'unlock-required' && showUnlock ? (
        <Box
          className="source-unlock-panel"
          flexDirection="row"
          alignItems="center"
          gap="s"
          style={{ flexWrap: 'wrap' }}
        >
          <Text variant="bodySmall" color="info120">
            Enter the credentials required by this KeePass file.
          </Text>
          <FormTextInput
            label="Master password"
            secureTextEntry
            placeholder="Master password"
            value={password}
            onChangeText={setPassword}
            style={{ flex: '1 1 180px', minWidth: 180 }}
          />
          <Box gap="xxs">
            <input
              type="file"
              aria-label="KeePass key file"
              onChange={async (event) => {
                const selected = event.target.files?.[0];
                setKeyFile(selected ? await selected.arrayBuffer() : undefined);
                setKeyFileName(selected?.name ?? '');
              }}
            />
            {keyFileName ? (
              <Text variant="bodySmall" color="gray">
                {keyFileName}
              </Text>
            ) : null}
          </Box>
          <Button
            title="Unlock"
            disabled={!onUnlock || (password.trim().length === 0 && !keyFile)}
            onPress={() => onUnlock?.(file, password, keyFile)}
          />
        </Box>
      ) : null}
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

const statusHex = {
  imported: theme.colors.success120,
  warning: theme.colors.warning200,
  'unlock-required': theme.colors.info120,
  retrying: theme.colors.info120,
  failed: theme.colors.danger120,
};
