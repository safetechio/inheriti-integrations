import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

export interface Column<TRow> {
  readonly header: string;
  readonly value: (row: TRow) => string;
  /** A column that may give width back when the terminal is too narrow for every natural width. */
  readonly flexible?: boolean;
  readonly minimum?: number;
  readonly dim?: boolean;
  readonly render?: (row: TRow) => ReactNode;
}

const GAP = 2;

/**
 * One table, sized to the terminal.
 *
 * Every row is a single `Text`, not a row of boxes: Ink wraps a box that overflows, and a wrapped
 * table is unreadable precisely when it matters — the columns stop lining up. Cells are padded to a
 * width computed here and the row is truncated instead, so a narrow terminal loses the end of a
 * value rather than the shape of the table.
 */
export function Table<TRow>({ columns, rows, width }: {
  columns: ReadonlyArray<Column<TRow>>;
  rows: readonly TRow[];
  width: number;
}) {
  const widths = allocate(columns, rows, width);
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        {columns.map((column, index) => (
          <Text key={column.header} bold color="cyan">{pad(column.header.toUpperCase(), widths[index]!)}</Text>
        ))}
      </Text>
      {rows.map((row, rowIndex) => (
        <Text key={rowIndex} wrap="truncate">
          {columns.map((column, index) => (
            <Text key={column.header} dimColor={column.dim === true}>
              {column.render ? column.render(row) : pad(cell(column.value(row)), widths[index]!)}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

/** A label and its value, for the blocks a table would only make harder to read. */
export function Field({ label, value }: { label: string; value: string }) {
  return (
    <Text wrap="truncate">
      <Text dimColor>{pad(label, 16)}</Text>
      <Text>{value}</Text>
    </Text>
  );
}

export function Heading({ children }: { children: string }) {
  return <Text bold color="cyan">{children}</Text>;
}

/**
 * Natural widths first, then give back what the terminal cannot show: flexible columns shrink
 * towards their minimum, longest first, and a fixed column never moves.
 */
function allocate<TRow>(
  columns: ReadonlyArray<Column<TRow>>,
  rows: readonly TRow[],
  width: number,
): number[] {
  const widths = columns.map((column) => Math.max(
    column.header.length,
    ...rows.map((row) => cell(column.value(row)).length),
    1,
  ) + GAP);
  const minimums = columns.map((column, index) => (column.flexible === true
    ? Math.min(widths[index]!, (column.minimum ?? 8) + GAP)
    : widths[index]!));

  let total = widths.reduce((sum, value) => sum + value, 0);
  while (total > width) {
    const candidates = widths
      .map((value, index) => ({ index, slack: value - minimums[index]! }))
      .filter((candidate) => candidate.slack > 0)
      .sort((left, right) => right.slack - left.slack);
    const widest = candidates[0];
    if (!widest) break;
    const reduction = Math.min(widest.slack, total - width);
    widths[widest.index] = widths[widest.index]! - reduction;
    total -= reduction;
  }
  return widths;
}

function cell(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function pad(value: string, width: number): string {
  const room = Math.max(width - GAP, 1);
  const text = value.length > room ? `${value.slice(0, Math.max(room - 1, 1))}…` : value.padEnd(room, ' ');
  return `${text}${' '.repeat(GAP)}`;
}
