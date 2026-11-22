"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/components/ui";
import { isAbort, type Page } from "@/lib/api";

type List<T> = { items: T[]; total: number; nextCursor: string | null };

// A list that arrives one page at a time: the first page loads by itself, loadMore() adds the next.
//
// `fetchPage` takes the cursor of the page to load (null for the first one) and an AbortSignal to pass to the request.
// Pass a new function (use useCallback) when what is listed changes, for example because the search text did. The list
// then starts again from page one, and any request for the old list is cancelled. While the new first page is on its
// way the old items stay on screen. retry() asks for the first page again, for when it could not be loaded.
export function usePaged<T extends { id: string }>(fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>) {
  // items, total and cursor live in one object so that every update changes them together
  const [list, setList] = useState<List<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Counts the lists asked for. An answer that arrives after a newer list was asked for is thrown away.
  const generation = useRef(0);
  // Cancels the requests of the current list. Replaced, and so cancelled, when the list changes or the page closes.
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const mine = ++generation.current;
    const ctl = new AbortController();
    controller.current = ctl;
    fetchPage(null, ctl.signal)
      .then((page) => {
        if (mine !== generation.current) return;
        setList({ items: page.items, total: page.total, nextCursor: page.next_cursor });
        setError(null);
      })
      .catch((err) => {
        if (mine === generation.current && !isAbort(err)) setError(errorMessage(err));
      });
    return () => ctl.abort();
  }, [fetchPage, attempt]);

  const nextCursor = list?.nextCursor ?? null;

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor, controller.current?.signal ?? new AbortController().signal);
      if (mine !== generation.current) return;
      setList((prev) => {
        if (!prev) return prev;
        // A page can overlap the list when items moved while the user was looking at it, so skip any already shown
        const seen = new Set(prev.items.map((i) => i.id));
        const fresh = page.items.filter((i) => !seen.has(i.id));
        return { items: [...prev.items, ...fresh], total: page.total, nextCursor: page.next_cursor };
      });
      setError(null);
    } catch (err) {
      if (mine === generation.current && !isAbort(err)) setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, nextCursor, loadingMore]);

  // For an item the user deleted or finished: take it out of the list and the count without asking the server again
  const removeItem = useCallback((id: string) => {
    setList((prev) => {
      if (!prev || !prev.items.some((i) => i.id === id)) return prev;
      return { ...prev, items: prev.items.filter((i) => i.id !== id), total: Math.max(0, prev.total - 1) };
    });
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    items: list?.items ?? null, // null until the first page arrives
    total: list?.total ?? 0,
    hasMore: nextCursor !== null,
    error,
    setError,
    loadingMore,
    loadMore,
    removeItem,
    retry,
  };
}
