'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { LinkIcon } from '@/components/ui/icons';
import { buttonPrimary } from '@/components/ui/styles';
import { createBookmark, queryKeys } from '@/lib/api/bookmarks';
import { ApiError } from '@/lib/api/client';

export function AddLinkForm() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const add = useMutation({
    mutationFn: createBookmark,
    onSuccess: ({ created }) => {
      setUrl('');
      setMessage(created ? null : { tone: 'info', text: 'You already saved this link.' });
      return queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks });
    },
    onError: (error) => {
      setMessage({
        tone: 'error',
        text:
          error instanceof ApiError && error.code === 'validation_error'
            ? 'That doesn’t look like a web link (it should start with http:// or https://).'
            : 'Couldn’t save the link. Please try again.',
      });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    setMessage(null);
    // Accept "example.com/page" as a convenience.
    add.mutate({ url: /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}` });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-rule-strong bg-surface p-1.5 pl-3.5 transition-colors focus-within:border-focus focus-within:ring-3 focus-within:ring-focus/20 hover:border-ink-soft">
        <span className="text-ink-soft">
          <LinkIcon />
        </span>
        <input
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste a link to save it"
          aria-label="Link to save"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] outline-none placeholder:text-ink-soft/80 focus-visible:outline-none"
        />
        <button type="submit" disabled={add.isPending || !url.trim()} className={buttonPrimary}>
          {add.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${message.tone === 'error' ? 'text-danger' : 'text-ink-soft'}`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
