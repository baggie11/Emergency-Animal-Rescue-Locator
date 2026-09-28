import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api.js';

/**
 * Minimal async loader: run(), loading, error, data.
 *
 * Deliberately not a data-fetching library. The app has three call sites and
 * each needs slightly different caching behaviour, so a small explicit hook is
 * easier to reason about than a generic abstraction.
 */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // Monotonic token: a slow earlier request must never overwrite a newer one.
  const token = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    const id = ++token.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current(...args);
      if (alive.current && id === token.current) setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      if (alive.current && id === token.current) {
        setState({ data: null, loading: false, error: err instanceof ApiError ? err : new Error(err.message) });
      }
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, run, setData: (data) => setState((s) => ({ ...s, data })) };
}
