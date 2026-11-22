"use client";

import { useCallback, useEffect, useState } from "react";
import { isAbort } from "@/lib/api";

type Result<T> = { load: unknown; data: T | null; error: Error | null };

// Loads one thing when the page opens: `load` gets an AbortSignal to pass to the request.
//
//  - The request is cancelled when the page is left, or when `load` changes (use useCallback, with the ids it depends on).
//  - An answer to a request that has been replaced is never used, so a slow reply cannot overwrite a newer one.
//  - Data from an earlier `load` is not handed out for the new one: moving from one set to another shows loading, not
//    the old set.
//  - reload() asks again. The data already on screen stays there until the new answer arrives.
//  - update() puts new data in place without asking, for the page that just changed something and got the result back.
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => setResult({ load, data, error: null }))
      .catch((err) => {
        if (controller.signal.aborted || isAbort(err)) return; // cancelled on purpose: nothing went wrong
        setResult((prev) => ({ load, data: prev?.load === load ? prev.data : null, error: err as Error }));
      });
    return () => controller.abort();
  }, [load, attempt]);

  const current = result?.load === load ? result : null;
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const update = useCallback((data: T) => setResult({ load, data, error: null }), [load]);

  return { data: current?.data ?? null, error: current?.error ?? null, reload, update };
}
