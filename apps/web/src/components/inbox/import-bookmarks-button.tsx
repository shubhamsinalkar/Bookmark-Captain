'use client';

import { MAX_INGEST_BATCH } from '@bc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useRef, useState } from 'react';
import { UploadIcon } from '@/components/ui/icons';
import { buttonGhost } from '@/components/ui/styles';
import { ingestBookmarks, queryKeys } from '@/lib/api/bookmarks';
import { parseNetscapeBookmarks } from '@/lib/import/netscape';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const numberFormat = new Intl.NumberFormat('en');

type ImportState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'finished'; created: number; updated: number; skipped: number }
  | { phase: 'failed'; message: string };

/** Imports a `bookmarks.html` export (Chrome, Firefox, Safari, Edge) in API-sized batches. */
export function ImportBookmarksButton() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({ phase: 'idle' });

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setState({ phase: 'failed', message: 'That file is larger than 20 MB.' });
      return;
    }

    const items = parseNetscapeBookmarks(await file.text());
    if (items.length === 0) {
      setState({
        phase: 'failed',
        message: 'No bookmarks found. Choose an exported bookmarks .html file.',
      });
      return;
    }

    const totals = { created: 0, updated: 0, skipped: 0 };
    setState({ phase: 'running', done: 0, total: items.length });
    try {
      for (let start = 0; start < items.length; start += MAX_INGEST_BATCH) {
        const batch = items.slice(start, start + MAX_INGEST_BATCH);
        const result = await ingestBookmarks(batch);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.skipped += batch.length - result.created - result.updated;
        setState({ phase: 'running', done: start + batch.length, total: items.length });
      }
      setState({ phase: 'finished', ...totals });
    } catch {
      setState({
        phase: 'failed',
        message: `Import stopped after ${numberFormat.format(totals.created)} new bookmarks. Please try again; nothing will be duplicated.`,
      });
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <input
        ref={fileInput}
        type="file"
        accept=".html,.htm,text/html"
        onChange={(event) => void handleFile(event)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={state.phase === 'running'}
        className={`${buttonGhost} -ml-2 text-ink`}
      >
        <UploadIcon />
        {state.phase === 'running'
          ? `Importing ${numberFormat.format(state.done)} / ${numberFormat.format(state.total)}…`
          : 'Import bookmarks.html'}
      </button>
      {state.phase === 'idle' && (
        <span className="text-[13px] text-ink-soft max-sm:hidden">
          exported from Chrome, Firefox, Safari or Edge
        </span>
      )}
      {state.phase === 'finished' && (
        <p role="status" className="text-[13px] font-medium text-good">
          Imported: {numberFormat.format(state.created)} new, {numberFormat.format(state.updated)}{' '}
          updated
          {state.skipped > 0 && `, ${numberFormat.format(state.skipped)} unchanged or skipped`}
        </p>
      )}
      {state.phase === 'failed' && (
        <p role="alert" className="text-[13px] text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}
