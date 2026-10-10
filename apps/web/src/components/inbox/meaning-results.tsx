'use client';

import type { BookmarkView, SearchByMeaningResult } from '@bc/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { hint } from '@/components/ui/styles';
import { BookmarkCollection } from './bookmark-collection';
import type { CardLayout } from './bookmark-card';

const numberFormat = new Intl.NumberFormat('en');

/**
 * "Related by meaning": bookmarks about the same idea as the search, in other words. Shown
 * under the word matches; hidden entirely when the server has no embedding provider.
 */
export function MeaningResults({
  search,
  layout,
  view,
  selectedId,
  onTopicSelect,
}: {
  search: UseQueryResult<SearchByMeaningResult>;
  layout: CardLayout;
  view: BookmarkView;
  selectedId: string | null;
  onTopicSelect: (topic: string) => void;
}) {
  if (search.isError) {
    return (
      <p role="status" className={`${hint} mt-8`}>
        Search by meaning is busy right now. Try again in a minute.
      </p>
    );
  }
  const result = search.data;
  if (!result?.available || result.items.length === 0) return null;

  return (
    <section aria-labelledby="meaning-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="meaning-heading" className="inline-flex items-center gap-2 text-base font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-accent-wash text-accent">
            <Sparkles size={15} aria-hidden />
          </span>
          Related by meaning
        </h2>
        <p className={hint}>Same idea, different words</p>
      </div>

      <BookmarkCollection
        items={result.items.map(({ bookmark }) => bookmark)}
        layout={layout}
        view={view}
        selectedId={selectedId}
        onTopicSelect={onTopicSelect}
        dimmed={search.isPlaceholderData}
      />

      {result.indexed < result.total && (
        <p className="text-[13px] text-ink-soft">
          Searched {numberFormat.format(result.indexed)} of {numberFormat.format(result.total)}{' '}
          bookmarks. The rest are included once their summaries are ready.
        </p>
      )}
    </section>
  );
}
