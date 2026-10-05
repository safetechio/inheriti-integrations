export function updateMarkedDraft(draft, marks, text) {
  let start = 0;
  while (start < draft.length && start < text.length && draft[start] === text[start]) start++;
  let suffix = 0;
  while (suffix < draft.length - start && suffix < text.length - start && draft[draft.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  const oldEnd = draft.length - suffix;
  const newEnd = text.length - suffix;
  const delta = text.length - draft.length;
  const adjusted = marks.map(([from, to]) => {
    if (to <= start) return [from, to];
    if (from >= oldEnd) return [from + delta, to + delta];
    return [Math.min(from, start), Math.max(newEnd, to + delta)];
  }).filter(([from, to]) => from < to);
  return adjusted.reduce((merged, [from, to]) => markDraft(merged, from, to), []);
}

export function markDraft(marks, start, end) {
  if (start >= end || start < 0) return marks;
  const merged = [];
  for (const [from, to] of marks.concat([[start, end]]).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged.length <= 4 ? merged : marks;
}

export function unmarkDraft(marks, start, end) {
  return marks.filter(([from, to]) => start === end ? !(from <= start && start < to) : to <= start || from >= end);
}

export function draftSegments(text, marks, mode) {
  if (!text.trim()) return [];
  if (mode === 'PROTECTED') return [{ protectedText: text }];
  if (!marks.length) return [{ text }];
  const segments = [];
  let offset = 0;
  for (const [start, end] of marks) {
    if (start > offset) segments.push({ text: text.slice(offset, start) });
    segments.push({ protectedText: text.slice(start, end) });
    offset = end;
  }
  if (offset < text.length) segments.push({ text: text.slice(offset) });
  return segments;
}

export function draftPreview(segments) {
  return segments.map(segment => 'text' in segment ? segment.text : '[Protected]').join('');
}
