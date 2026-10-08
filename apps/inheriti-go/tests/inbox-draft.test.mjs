import { expect, it } from 'vitest';
import { draftPreview, draftSegments, markDraft, unmarkDraft, updateMarkedDraft } from '../src/modules/inbox/ui/hooks/inboxDraft.js';

it('keeps ordered normal and protected spans while masking preview', () => {
  const marks = markDraft(markDraft([], 6, 12), 17, 23);
  const segments = draftSegments('Hello secret and hidden', marks, 'NORMAL');
  expect(segments).toEqual([{ text: 'Hello ' }, { protectedText: 'secret' }, { text: ' and ' }, { protectedText: 'hidden' }]);
  expect(draftPreview(segments)).toBe('Hello [Protected] and [Protected]');
  expect(draftPreview(segments)).not.toContain('secret');
  expect(draftSegments('Hello secret and hidden', marks, 'PROTECTED')).toEqual([{ protectedText: 'Hello secret and hidden' }]);
  expect(unmarkDraft(marks, 8, 8)).toEqual([[17, 23]]);
});

it('moves marks with draft edits and caps protected units at four', () => {
  const marks = [[6, 12]];
  expect(updateMarkedDraft('Hello secret', marks, 'Hey Hello secret')).toEqual([[10, 16]]);
  expect(updateMarkedDraft('Hello secret', marks, 'Hello secret!')).toEqual(marks);
  expect(updateMarkedDraft('abc  def', [[0, 3], [5, 8]], 'abXef')).toEqual([[0, 5]]);
  expect(markDraft([[0, 1], [2, 3], [4, 5], [6, 7]], 8, 9)).toHaveLength(4);
});
