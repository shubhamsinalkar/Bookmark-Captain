'use client';

import type { SearchByMeaningResult } from '@bc/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { SparkleIcon } from '@/components/ui/icons';
import { hint, panel } from '@/components/ui/styles';
import { BookmarkCard } from './bookmark-card';

const numberFormat = new Intl.NumberFormat('en');

/**
 * "Related by meaning": bookmarks about the same idea as the search, in other words. Shown
 * under the word matches; hidden entirely when the server has no embedding provider.
 */
export function MeaningResults({
  search,
  onTopicSelect,
}: {
  search: UseQueryResult<SearchByMeaningResult>;
  onTopicSelect: (topic: string) => void;
}) {
  if (search.isError) {
    return (
      <p role="status" className={`${hint} mt-6`}>
        Search by meaning is busy right now. Try again in a minute.
      </p>
    );
  }
  const result = search.data;
  if (!result?.available || result.items.length === 0) return null;

  return (
    <section aria-labelledby="meaning-heading" className="mt-8 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="meaning-heading" className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <SparkleIcon width="14" height="14" className="text-focus" />
          Related by meaning
        </h2>
        <p className={hint}>Same idea, different words</p>
      </div>

      <ul
        className={`${panel} divide-y divide-rule transition-opacity ${search.isPlaceholderData ? 'opacity-60' : ''}`}
      >
        {result.items.map(({ bookmark }) => (
          <li key={bookmark.id} className="first:rounded-t-xl last:rounded-b-xl">
            <BookmarkCard bookmark={bookmark} onTopicSelect={onTopicSelect} />
          </li>
        ))}
      </ul>

      {result.indexed < result.total && (
        <p className="text-[13px] text-ink-soft">
          Searched {numberFormat.format(result.indexed)} of {numberFormat.format(result.total)}{' '}
          bookmarks. The rest are included once their summaries are ready.
        </p>
      )}
    </section>
  );
}
