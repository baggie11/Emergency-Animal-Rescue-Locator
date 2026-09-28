import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Wraps the browser geolocation API.
 *
 * The happy path is a one-shot `getCurrentPosition`. The two states that matter
 * most here are the failure modes: the user is standing on a street, possibly
 * indoors, and we must give them a manual fallback immediately rather than
 * leaving a spinner on screen.
 */
export function useGeolocation() {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | locating | granted | denied | unavailable
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const locate = useCallback(
    ({ timeout = 10000 } = {}) =>
      new Promise((resolve) => {
        if (!('geolocation' in navigator)) {
          setStatus('unavailable');
          setError('This browser does not support location access.');
          resolve(null);
          return;
        }

        setStatus('locating');
        setError(null);

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!mounted.current) return;
            const next = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              at: Date.now(),
            };
            setPosition(next);
            setStatus('granted');
            resolve(next);
          },
          (err) => {
            if (!mounted.current) return;
            const messages = {
              1: 'Location permission was denied. Search for your area instead.',
              2: 'Could not determine your location. Search for your area instead.',
              3: 'Location request timed out. Search for your area instead.',
            };
            setStatus(err.code === 1 ? 'denied' : 'unavailable');
            setError(messages[err.code] || 'Could not determine your location.');
            resolve(null);
          },
          { enableHighAccuracy: true, timeout, maximumAge: 60000 },
        );
      }),
    [],
  );

  return { position, status, error, locate, setPosition };
}

/**
 * Loads /api/meta and /api/config once. These never change at runtime, so they
 * are fetched a single time and cached by the API layer.
 */
export function useAppBootstrap() {
  const [meta, setMeta] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [metaRes, configRes] = await Promise.all([api.meta(), api.config()]);
      setMeta(metaRes);
      setConfig(configRes.config);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { meta, config, error, reload };
}
