'use client';

import { MAX_INGEST_BATCH } from '@bc/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { buttonSecondary } from '@/components/ui/styles';
import { useToast } from '@/components/ui/toaster';
import { ingestBookmarks, queryKeys } from '@/lib/api/bookmarks';
import { parseNetscapeBookmarks } from '@/lib/import/netscape';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const numberFormat = new Intl.NumberFormat('en');

/** Imports a `bookmarks.html` export (Chrome, Firefox, Safari, Edge) in API-sized batches. */
export function ImportBookmarksButton({ className = '' }: { className?: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast({ message: 'That file is larger than 20 MB.', tone: 'error' });
      return;
    }

    const items = parseNetscapeBookmarks(await file.text());
    if (items.length === 0) {
      toast({
        message: 'No bookmarks found. Choose a bookmarks .html file exported from your browser.',
        tone: 'error',
      });
      return;
    }

    const totals = { created: 0, updated: 0, skipped: 0 };
    setProgress({ done: 0, total: items.length });
    try {
      for (let start = 0; start < items.length; start += MAX_INGEST_BATCH) {
        const batch = items.slice(start, start + MAX_INGEST_BATCH);
        const result = await ingestBookmarks(batch);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.skipped += batch.length - result.created - result.updated;
        setProgress({ done: start + batch.length, total: items.length });
      }
      const skipped =
        totals.skipped > 0 ? `, ${numberFormat.format(totals.skipped)} unchanged or skipped` : '';
      toast({
        message: `Imported ${numberFormat.format(totals.created)} new, ${numberFormat.format(totals.updated)} updated${skipped}`,
      });
    } catch {
      toast({
        message: `Import stopped after ${numberFormat.format(totals.created)} new bookmarks. Try again; nothing will be duplicated.`,
        tone: 'error',
      });
    } finally {
      setProgress(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks });
    }
  }

  return (
    <>
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
        disabled={progress !== null}
        title="Import a bookmarks.html file exported from Chrome, Firefox, Safari or Edge"
        className={`${buttonSecondary} h-9 px-3 ${className}`}
      >
        {progress ? (
          <LoaderCircle size={16} className="animate-spin" aria-hidden />
        ) : (
          <Upload size={16} aria-hidden />
        )}
        {progress
          ? `Importing ${numberFormat.format(progress.done)} / ${numberFormat.format(progress.total)}`
          : 'Import'}
      </button>
    </>
  );
}
