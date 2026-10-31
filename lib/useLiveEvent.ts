"use client";

import useSWR from "swr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape returned by /api/events/[id] – expand as features are built. */
export interface LiveEvent {
  id: string;
  stage: string;
  answers: Record<string, unknown>;
  event_type: string | null;
  event_date: string | null;
  budget_total: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetcher(url: string): Promise<LiveEvent> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch event: ${res.status}`);
  return res.json() as Promise<LiveEvent>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useLiveEvent – polls the event endpoint every 3 seconds via SWR.
 * No WebSockets required; the server is stateless.
 *
 * @param eventId UUID of the event to watch, or null/undefined to skip.
 *
 * TODO: Replace placeholder API path with the real route once implemented.
 */
export function useLiveEvent(eventId: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<LiveEvent>(
    eventId ? `/api/events/${eventId}` : null,
    fetcher,
    {
      refreshInterval: 3000,   // poll every 3 s
      revalidateOnFocus: true,
    }
  );

  return {
    event: data,
    isLoading,
    isError: !!error,
    error,
    refresh: mutate,
  };
}
