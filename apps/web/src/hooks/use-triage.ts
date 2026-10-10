'use client';

import type { Bookmark, UpdateBookmarkRequest } from '@bc/shared';
import { useToast } from '@/components/ui/toaster';
import { useBookmarkMutations } from './use-bookmark-mutations';

const ERROR_MESSAGE = 'That didn’t save. Try again.';

/**
 * The actions you take on a bookmark, each confirmed by a toast; those that move it out of
 * the way (done, snooze, archive) offer Undo, which puts back its previous status and snooze.
 */
export function useTriage() {
  const { update, remove } = useBookmarkMutations();
  const toast = useToast();

  const onError = () => toast({ message: ERROR_MESSAGE, tone: 'error' });

  function change(bookmark: Bookmark, patch: UpdateBookmarkRequest, message: string) {
    update.mutate({ id: bookmark.id, patch }, { onError });
    toast({
      message,
      action: {
        label: 'Undo',
        onClick: () =>
          update.mutate(
            {
              id: bookmark.id,
              patch: { status: bookmark.status, snoozeUntil: bookmark.snoozeUntil },
            },
            { onError },
          ),
      },
    });
  }

  return {
    done: (bookmark: Bookmark) => change(bookmark, { status: 'done' }, 'Marked done'),
    archive: (bookmark: Bookmark) => change(bookmark, { status: 'archived' }, 'Archived'),
    snooze: (bookmark: Bookmark, until: Date, label: string) =>
      change(bookmark, { snoozeUntil: until.toISOString() }, `Snoozed until ${label}`),
    unsnooze: (bookmark: Bookmark) => change(bookmark, { snoozeUntil: null }, 'Back in your inbox'),
    backToInbox: (bookmark: Bookmark) =>
      change(bookmark, { status: 'unread', snoozeUntil: null }, 'Back in your inbox'),
    /** Opening a link marks it read; no toast for that. */
    markOpened: (bookmark: Bookmark) => {
      if (bookmark.status === 'unread') {
        update.mutate({ id: bookmark.id, patch: { status: 'opened' } });
      }
    },
    remove: (bookmark: Bookmark) => {
      remove.mutate(bookmark.id, { onError });
      toast({ message: 'Deleted' });
    },
  };
}

export type Triage = ReturnType<typeof useTriage>;
