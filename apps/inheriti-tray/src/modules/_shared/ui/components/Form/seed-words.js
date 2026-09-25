export function placePastedWords(current, index, text) {
  const pasted = text.trim().split(/\s+/).filter(Boolean);
  if (!pasted.length || index + pasted.length > 24 || pasted.some((word) => word.length > 8)) throw new Error('invalid_seed_words');
  const next = current.slice();
  while (next.length < index + pasted.length) next.push('');
  pasted.forEach((word, offset) => { next[index + offset] = word; });
  return next;
}
