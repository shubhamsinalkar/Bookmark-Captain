'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { buttonDanger, buttonGhost, hint, panel } from '@/components/ui/styles';
import { listApiTokens, queryKeys, revokeApiToken } from '@/lib/api/bookmarks';
import { formatRelativeTime } from '@/lib/format';

export function ConnectedDevices() {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const tokens = useQuery({ queryKey: queryKeys.apiTokens, queryFn: listApiTokens });

  const revoke = useMutation({
    mutationFn: revokeApiToken,
    onSettled: () => {
      setConfirmingId(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens });
    },
  });

  if (tokens.isPending) return <p className={hint}>Loading…</p>;
  if (tokens.isError) {
    return <p className="text-sm text-danger">Couldn&apos;t load devices.</p>;
  }
  if (tokens.data.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-rule-strong px-4 py-6 text-center text-sm text-ink-soft">
        No devices connected.
      </p>
    );
  }

  return (
    <ul className={`${panel} divide-y divide-rule`}>
      {tokens.data.map((token) => (
        <li
          key={token.id}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">{token.name}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-soft">
              <code className="rounded bg-sunken px-1 text-xs">{token.preview}…</code>
              <span>Connected {formatRelativeTime(token.createdAt)}</span>
              <span>
                {token.lastUsedAt
                  ? `Last used ${formatRelativeTime(token.lastUsedAt)}`
                  : 'Never used'}
              </span>
            </p>
          </div>
          {confirmingId === token.id ? (
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                className={buttonDanger}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(token.id)}
              >
                Confirm disconnect
              </button>
              <button type="button" className={buttonGhost} onClick={() => setConfirmingId(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={`${buttonGhost} hover:text-danger`}
              onClick={() => setConfirmingId(token.id)}
            >
              Disconnect
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
