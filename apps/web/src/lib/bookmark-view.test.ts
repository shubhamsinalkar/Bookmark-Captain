import { describe, expect, it } from 'vitest';
import { matchesView } from './bookmark-view';

const now = new Date('2026-03-10T12:00:00Z');
const future = '2026-03-11T09:00:00Z';
const past = '2026-03-09T09:00:00Z';

describe('matchesView', () => {
  it.each([
    [{ status: 'unread', snoozeUntil: null }, ['inbox', 'all']],
    [{ status: 'opened', snoozeUntil: past }, ['inbox', 'all']],
    [{ status: 'unread', snoozeUntil: future }, ['snoozed', 'all']],
    [{ status: 'done', snoozeUntil: future }, ['done', 'all']],
    [{ status: 'archived', snoozeUntil: null }, ['archived', 'all']],
  ] as const)('%o appears in %o', (bookmark, views) => {
    const all = ['inbox', 'snoozed', 'done', 'archived', 'all'] as const;
    expect(all.filter((view) => matchesView(bookmark, view, now))).toEqual(views);
  });
});
