'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, LoaderCircle, Search, X } from 'lucide-react';
import { type FormEvent, type Ref, useState } from 'react';
import { buttonAccent } from '@/components/ui/styles';
import { useToast } from '@/components/ui/toaster';
import { createBookmark, queryKeys } from '@/lib/api/bookmarks';
import { ApiError } from '@/lib/api/client';
import { looksLikeLink } from '@/lib/inbox-url';

/**
 * One box for both jobs: typing searches your bookmarks, pasting a link offers to save it.
 */
export function SearchOrSave({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const isLink = looksLikeLink(value);

  const save = useMutation({
    mutationFn: createBookmark,
    onSuccess: ({ created }) => {
      onChange('');
      toast({ message: created ? 'Saved to your inbox' : 'You already saved this link.' });
      return queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.code === 'validation_error'
          ? 'That doesn’t look like a web link. It should start with http:// or https://.'
          : 'Couldn’t save the link. Try again.',
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!isLink || save.isPending) return;
    setError(null);
    // Accept "example.com/page" as a convenience.
    save.mutate({ url: /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}` });
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="space-y-2">
      <div
        className={`flex h-12 items-center gap-2.5 rounded-2xl border bg-surface pr-1.5 pl-4 shadow-card transition-[border-color,box-shadow] focus-within:ring-4 ${
          isLink
            ? 'border-accent/60 ring-accent/10 focus-within:ring-accent/15'
            : 'border-rule-strong hover:border-ink-faint focus-within:border-accent focus-within:ring-accent/15'
        }`}
      >
        {isLink ? (
          <Link2 size={18} className="shrink-0 text-accent" aria-hidden />
        ) : (
          <Search size={18} className="shrink-0 text-ink-soft" aria-hidden />
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            setError(null);
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && value) {
              event.preventDefault();
              onChange('');
            }
          }}
          placeholder="Search your saves, or paste a link to save it"
          aria-label="Search or paste a link"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint={isLink ? 'go' : 'search'}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
        />
        {value && !save.isPending && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => onChange('')}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-sunken hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        )}
        {isLink ? (
          <button type="submit" disabled={save.isPending} className={`${buttonAccent} h-9 px-3.5`}>
            {save.isPending && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
            {save.isPending ? 'Saving…' : 'Save link'}
          </button>
        ) : (
          !value && (
            <kbd className="mr-1.5 hidden h-6 min-w-6 place-items-center rounded-md border border-rule border-b-2 bg-sunken px-1.5 text-xs font-semibold text-ink-soft can-hover:grid">
              /
            </kbd>
          )
        )}
      </div>
      {error && (
        <p role="alert" className="px-1 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
