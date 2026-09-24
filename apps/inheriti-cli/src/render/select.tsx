import { useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import type { Candidate } from '../completion/candidates.js';
import { requestCliCancel } from '../cancellation.js';

const VISIBLE = 10;

/**
 * The picker shown when a command needs an identifier the operator does not have memorised.
 *
 * Typing filters rather than jumping, because a plan id is not something anyone types from memory —
 * the filter runs over the description too, so "wallet" finds the plan whose id means nothing.
 */
function Select({ title, candidates, onChoose, onCancel, onInterrupt }: {
  title: string;
  candidates: readonly Candidate[];
  onChoose: (value: string) => void;
  onCancel: () => void;
  onInterrupt: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const matches = candidates.filter((candidate) => matching(candidate, query));
  const active = Math.min(cursor, Math.max(matches.length - 1, 0));

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return onInterrupt();
    if (key.escape) return onCancel();
    if (key.return) {
      const chosen = matches[active];
      return chosen ? onChoose(chosen.value) : onCancel();
    }
    if (key.upArrow) return setCursor(Math.max(active - 1, 0));
    if (key.downArrow) return setCursor(Math.min(active + 1, Math.max(matches.length - 1, 0)));
    if (key.backspace || key.delete) {
      setCursor(0);
      return setQuery(query.slice(0, -1));
    }
    if (input && !key.ctrl && !key.meta) {
      setCursor(0);
      setQuery(query + input);
    }
  });

  const window = matches.slice(Math.max(0, active - VISIBLE + 1), Math.max(0, active - VISIBLE + 1) + VISIBLE);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{title}</Text>
      <Text dimColor>{`filter: ${query || '(type to narrow)'} · ↑↓ to move · enter to choose · esc to cancel`}</Text>
      {matches.length === 0 ? <Text dimColor>Nothing matches.</Text> : window.map((candidate) => {
        const selected = candidate === matches[active];
        return (
          <Text key={candidate.value} {...(selected ? { color: 'cyan' } : {})}>
          {selected ? '❯ ' : '  '}
          {candidate.label ? <><Text bold>{candidate.label}</Text>{candidate.description ? <Text dimColor>{` — ${candidate.description}`}</Text> : null}</>
            : <>{candidate.description ? `${candidate.description}  ` : ''}<Text dimColor>{candidate.value}</Text></>}
          </Text>
        );
      })}
    </Box>
  );
}

function matching(candidate: Candidate, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return candidate.value.toLowerCase().includes(needle)
    || (candidate.label ?? '').toLowerCase().includes(needle)
    || (candidate.description ?? '').toLowerCase().includes(needle);
}

/** Resolves to the chosen value, or `undefined` when the operator cancels. */
export async function promptSelect(title: string, candidates: readonly Candidate[], signal?: AbortSignal): Promise<string | undefined> {
  if (candidates.length === 0 || signal?.aborted) return undefined;
  let chosen: string | undefined;
  let stop = () => {};
  const instance = render(
    <Select
      title={title}
      candidates={candidates}
      onChoose={(value) => { chosen = value; stop(); }}
      onCancel={() => { stop(); }}
      onInterrupt={() => { requestCliCancel(); if (!signal?.aborted) stop(); }}
    />,
    { exitOnCtrlC: false },
  );
  stop = () => { instance.clear(); instance.unmount(); };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  try { await instance.waitUntilExit(); }
  finally { signal?.removeEventListener('abort', stop); }
  return chosen;
}

function MultiSelect({ title, candidates, onChoose, onCancel, onInterrupt }: {
  title: string;
  candidates: readonly Candidate[];
  onChoose: (values: string[]) => void;
  onCancel: () => void;
  onInterrupt: () => void;
}) {
  const all = { value: '__ALL__', description: 'ALL' };
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const matches = candidates.filter((candidate) => matching(candidate, query));
  const choices = [all, ...matches];
  const active = Math.min(cursor, choices.length - 1);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return onInterrupt();
    if (key.escape) return onCancel();
    if (key.return) return selected.size ? onChoose(candidates.filter((one) => selected.has(one.value)).map((one) => one.value)) : onCancel();
    if (key.upArrow) return setCursor(Math.max(active - 1, 0));
    if (key.downArrow) return setCursor(Math.min(active + 1, choices.length - 1));
    if (input === ' ') {
      const value = choices[active]?.value;
      if (!value) return;
      if (value === all.value) {
        const every = candidates.every((one) => selected.has(one.value));
        return setSelected(every ? new Set() : new Set(candidates.map((one) => one.value)));
      }
      const next = new Set(selected);
      next.has(value) ? next.delete(value) : next.add(value);
      return setSelected(next);
    }
    if (key.backspace || key.delete) {
      setCursor(0);
      return setQuery(query.slice(0, -1));
    }
    if (input && !key.ctrl && !key.meta) {
      setCursor(0);
      setQuery(query + input);
    }
  });

  const start = Math.max(0, active - VISIBLE + 1);
  const window = choices.slice(start, start + VISIBLE);
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{title}</Text>
      <Text dimColor>{`filter: ${query || '(type to narrow)'} · ↑↓ to move · space to toggle · enter to reveal · esc to cancel`}</Text>
      {window.map((candidate, index) => {
        const highlighted = start + index === active;
        const checked = candidate.value === all.value
          ? candidates.length > 0 && candidates.every((one) => selected.has(one.value))
          : selected.has(candidate.value);
        return (
          <Text key={candidate.value} {...(highlighted ? { color: 'cyan' } : {})}>
            {highlighted ? '❯ ' : '  '}{checked ? '[x] ' : '[ ] '}
            {candidate.description ? `${candidate.description}  ` : ''}
            {candidate.value === all.value ? '' : <Text dimColor>{candidate.value}</Text>}
          </Text>
        );
      })}
    </Box>
  );
}

/** Resolves to all toggled values. ALL is a convenience toggle and is never returned as a selector. */
export async function promptMultiSelect(title: string, candidates: readonly Candidate[], signal?: AbortSignal): Promise<string[] | undefined> {
  if (candidates.length === 0 || signal?.aborted) return undefined;
  let chosen: string[] | undefined;
  let stop = () => {};
  const instance = render(
    <MultiSelect
      title={title}
      candidates={candidates}
      onChoose={(values) => { chosen = values; stop(); }}
      onCancel={() => { stop(); }}
      onInterrupt={() => { requestCliCancel(); if (!signal?.aborted) stop(); }}
    />,
    { exitOnCtrlC: false },
  );
  stop = () => { instance.clear(); instance.unmount(); };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  try { await instance.waitUntilExit(); }
  finally { signal?.removeEventListener('abort', stop); }
  return chosen;
}
