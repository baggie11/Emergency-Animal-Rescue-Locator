import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { useAppBootstrap, useGeolocation } from './hooks/useAppData.js';
import { useOnlineStatus } from './hooks/useOnlineStatus.js';
import { useAsync } from './hooks/useAsync.js';
import { cx } from './lib/format.js';

import HelplineBanner from './components/HelplineBanner.jsx';
import LocationPicker from './components/LocationPicker.jsx';
import Filters from './components/Filters.jsx';
import OrgCard from './components/OrgCard.jsx';
import RescueMap from './components/RescueMap.jsx';
import ReportForm from './components/ReportForm.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import {
  SpinnerIcon,
  ListIcon,
  MapIcon,
  AlertIcon,
  HeartIcon,
  SearchIcon,
} from './components/icons.jsx';

const EMPTY_FILTERS = {
  categories: [],
  is24x7: false,
  situations: [],
  animals: [],
  services: [],
  // Off by default: a user in an emergency needs the nearest option, not only
  // the subset someone has phoned. It is offered as an opt-in filter instead.
  verifiedOnly: false,
};

/**
 * Situation type -> services that would genuinely help. Mirrors the server-side
 * ranking in models/rescueRequests.js so the filter chips and the suggested
 * organisations never disagree about what "injured" means.
 */
const SITUATION_SERVICES = {
  injured: ['first_aid', 'ambulance', 'rescue'],
  sick: ['first_aid', 'ambulance', 'rescue'],
  trapped: ['capture_only', 'rescue'],
  aggressive: ['capture_only', 'rescue'],
  deceased: ['cremation', 'capture_only'],
};

/**
 * Hash-based two-route router ("#" and "#/admin").
 *
 * Hash rather than the History API on purpose: it needs no server rewrite rule
 * on any static host, and changing the hash fires `hashchange` reliably — which
 * `history.pushState` does not, so it would silently fail to re-render.
 */
function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0];

  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route === 'admin' ? 'admin' : 'home';
}

export const goAdmin = () => {
  window.location.hash = '#/admin';
};

export default function App() {
  const route = useRoute();
  const { meta, config, error: bootError } = useAppBootstrap();

  if (route === 'admin') return <AdminPanel meta={meta} />;

  if (!meta) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-100 px-4 text-center">
        {bootError ? (
          <div className="max-w-sm">
            <AlertIcon size={32} className="mx-auto text-vet" />
            <h1 className="mt-3 text-xl font-bold">Could not load the directory</h1>
            <p className="mt-1 text-ink-600">{bootError}</p>
            <p className="mt-3 text-sm text-ink-600">
              If this animal needs help right now, call your local municipal animal control or the
              national emergency number directly.
            </p>
            <button onClick={() => window.location.reload()} className="btn-primary mt-5 w-full">
              Try again
            </button>
          </div>
        ) : (
          <div>
            <SpinnerIcon size={30} className="text-ink-600" />
            <p className="mt-3 text-ink-600">Loading…</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Home
      meta={meta}
      config={config}
      onAdmin={goAdmin}
    />
  );
}

/* ------------------------------------------------------------------ home */

function Home({ meta, config, onAdmin }) {
  const { position, status, error: geoError, locate, setPosition } = useGeolocation();
  const online = useOnlineStatus();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [viewingReport, setViewingReport] = useState(false);
  const [originLabel, setOriginLabel] = useState(null);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [hideHelplineNote, setHideHelplineNote] = useState(false);
  const cardRefs = useRef(new Map());

  const serviceLabels = useMemo(
    () => Object.fromEntries(meta.services.map((s) => [s.id, s.label])),
    [meta],
  );

  // Ask for location once on load. A denial is a normal outcome, not an error
  // state, so it falls through to the manual picker.
  useEffect(() => {
    if (status === 'idle') locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = useMemo(
    () => ({
      lat: position?.lat,
      lng: position?.lng,
      categories: filters.categories,
      is24x7: filters.is24x7,
      // Only send a service filter when the user picked a situation, so the
      // default "injured" does not silently hide the right answers.
      services:
        filters.situations.length === 1
          ? SITUATION_SERVICES[filters.situations[0]]
          : filters.services,
      animals: filters.animals,
      verifiedOnly: filters.verifiedOnly,
      limit: 50,
    }),
    [position, filters],
  );

  const results = useAsync(
    () => (position ? api.nearby(query) : Promise.resolve(null)),
    [query.lat, query.lng, filters.categories.join(','), filters.is24x7, filters.situations.join(','), filters.animals.join(','), filters.services.join(','), filters.verifiedOnly],
  );

  const list = results.data?.results || [];
  const fromCache = !!results.data?.__fromCache;
  // The curated half of the list is unaffected by a live-lookup failure, so this
  // is a footnote, not an error. A red banner here would tell someone in an
  // emergency that the whole app is broken when it is not.
  const liveUnavailable = !fromCache && !!results.data?.liveLookupUnavailable;

  /* Keep the selected card in view when the user taps a map pin. */
  useEffect(() => {
    if (!selectedId || view !== 'list') return;
    const el = cardRefs.current.get(selectedId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedId, view]);

  const selectOrg = useCallback((id) => {
    setSelectedId(id);
    if (window.matchMedia('(max-width: 640px)').matches) setView('list');
  }, []);

  const pickLocality = (locality) => {
    if (!locality?.lat || !locality?.lng) {
      alert(`No contacts found for “${locality?.value}” yet. Try a nearby major city.`);
      return;
    }
    setPosition({ lat: locality.lat, lng: locality.lng, at: Date.now() });
    setOriginLabel(locality.value);
  };

  const reportOrigin = position ? { ...position, label: originLabel } : null;

  /* --------------------------------------------------------- report view */
  if (viewingReport) {
    return (
      <div className="min-h-dvh bg-ink-100">
        <HelplineBanner config={config} hideNote={hideHelplineNote} onDismissNote={() => setHideHelplineNote(true)} />
        <ReportForm
          origin={reportOrigin}
          meta={meta}
          onBack={() => setViewingReport(false)}
          onSubmitted={() => window.scrollTo({ top: 0 })}
          onChangeOrigin={(next) => {
            setPosition(next);
            setOriginLabel(next.label);
          }}
        />
      </div>
    );
  }

  /* -------------------------------------------------- no location yet */
  if (!position) {
    return (
      <div className="min-h-dvh bg-ink-100">
        <HelplineBanner config={config} hideNote={hideHelplineNote} onDismissNote={() => setHideHelplineNote(true)} />
        <div className="mx-auto max-w-lg p-5 pt-8">
          <header className="mb-6 text-center">
            <span className="mx-auto mb-3 grid size-16 place-items-center rounded-2xl bg-brand-100 text-brand-700">
              <HeartIcon size={34} />
            </span>
            <h1 className="text-3xl leading-tight font-bold text-balance">
              Rescue Nearby
            </h1>
            <p className="mt-2 text-ink-600">
              Found an injured, sick or trapped animal? See the nearest rescue NGO, veterinary
              hospital and animal control — with one-tap call and directions.
            </p>
          </header>

          <div className="card p-5">
            <LocationPicker
              status={status}
              error={geoError}
              locating={status === 'locating'}
              onLocate={() => locate()}
              onPickLocality={pickLocality}
            />
          </div>

          <button onClick={onAdmin} className="mx-auto mt-6 block text-sm text-ink-600 underline">
            Admin
          </button>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------- results screen */
  return (
    <div className="min-h-dvh bg-ink-100">
      <HelplineBanner config={config} hideNote={hideHelplineNote} onDismissNote={() => setHideHelplineNote(true)} />

      {!online && (
        <p className="flex items-center gap-2 bg-ink-800 px-4 py-2 text-sm font-medium text-white">
          <AlertIcon size={16} />
          You are offline{fromCache ? ' — showing saved results' : ''}
        </p>
      )}

      {fromCache && online && (
        <p className="flex items-center gap-2 bg-ink-800 px-4 py-2 text-sm font-medium text-white">
          <AlertIcon size={16} />
          Showing saved results — could not reach the server.
        </p>
      )}

      {liveUnavailable && (
        <p
          role="status"
          className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
        >
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>Live vet lookup is unavailable</strong> — the OpenStreetMap
            service did not respond. The contacts below are our own verified
            listings only.
          </span>
        </p>
      )}

      <Filters
        meta={meta}
        filters={filters}
        onChange={setFilters}
        resultCount={list.length}
        totalCount={list.length}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      <LocationBar
        origin={position}
        label={originLabel}
        accuracy={position.accuracy}
        onChange={() => {
          setPosition(null);
          setFilters(EMPTY_FILTERS);
        }}
      />

      {results.loading && (
        <p className="flex items-center justify-center gap-2 p-10 text-ink-600">
          <SpinnerIcon size={22} /> Finding nearby help…
        </p>
      )}

      {results.error && (
        <div className="m-4 rounded-xl bg-vet-bg p-4">
          <p className="font-semibold text-vet">{results.error}</p>
          <button onClick={() => results.run()} className="btn-ghost mt-3 w-full">
            Try again
          </button>
        </div>
      )}

      {!results.loading && !results.error && list.length === 0 && (
        <EmptyState
          filters={filters}
          onClear={() => setFilters(EMPTY_FILTERS)}
          onReport={() => setViewingReport(true)}
        />
      )}

      {!results.loading && list.length > 0 && (
        <>
          {/* Mobile: one view at a time. Desktop: list and map side by side. */}
          <div className="mx-auto flex max-w-6xl gap-4 p-4">
            <div className={cx('w-full lg:w-1/2', view === 'map' && 'hidden lg:block')}>
              <ul className="space-y-3">
                {list.map((org) => (
                  <OrgCard
                    key={org.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(org.id, el);
                      else cardRefs.current.delete(org.id);
                    }}
                    org={org}
                    serviceLabels={serviceLabels}
                    active={org.id === selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </ul>

              {showDisclaimer && config?.dataDisclaimer && (
                <p className="mt-4 rounded-xl bg-ink-200 p-3 text-center text-xs text-ink-700">
                  {config.dataDisclaimer}
                  <button
                    onClick={() => setShowDisclaimer(false)}
                    className="ml-2 font-semibold underline"
                  >
                    Dismiss
                  </button>
                </p>
              )}

              <Footer onAdmin={onAdmin} />
            </div>

            {/* The map is a permanent half-pane on desktop, and takes over the
                full screen on mobile only when the map toggle is active. */}
            <div className={cx(view === 'map' ? 'block w-full lg:block lg:w-1/2' : 'hidden w-1/2 lg:block')}>
              <div className="sticky top-32 overflow-hidden rounded-2xl ring-1 ring-ink-200">
                <RescueMap
                  results={list}
                  origin={position}
                  selectedId={selectedId}
                  onSelect={selectOrg}
                  className="h-[70vh] w-full"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Floating actions */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 p-3 sm:hidden">
        <div className="pointer-events-auto flex w-full max-w-md gap-2">
          <button
            onClick={() => setViewingReport(true)}
            className="tap flex-1 bg-brand-600 font-bold text-white shadow-lg active:bg-brand-700"
          >
            <HeartIcon size={20} />
            Request rescue
          </button>
          <button
            onClick={() => setView(view === 'list' ? 'map' : 'list')}
            aria-label={view === 'list' ? 'Show map' : 'Show list'}
            className="tap w-14 shrink-0 bg-ink-900 font-bold text-white shadow-lg"
          >
            {view === 'list' ? <MapIcon size={20} /> : <ListIcon size={20} />}
          </button>
        </div>
      </div>

      {/* Desktop report CTA */}
      <div className="sticky bottom-0 z-20 hidden border-t border-ink-200 bg-white p-3 sm:block">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <p className="flex-1 text-sm text-ink-600">
            {list.length} contact{list.length === 1 ? '' : 's'} within reach.
          </p>
          <button onClick={() => setViewingReport(true)} className="btn-call">
            <HeartIcon size={20} />
            Request rescue
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

const LocationBar = ({ origin, label, accuracy, onChange }) => (
  <div className="flex items-center gap-2 border-b border-ink-200 bg-white px-4 py-2">
    <SearchIcon size={16} className="shrink-0 text-ink-600" />
    <p className="min-w-0 flex-1 truncate text-sm text-ink-700">
      <span className="font-semibold">
        {label || 'Your current location'}
      </span>
      {accuracy != null && (
        <span className="text-ink-600"> · accurate to {Math.round(accuracy)} m</span>
      )}
    </p>
    <button onClick={onChange} className="shrink-0 text-sm font-semibold text-brand-700 underline">
      Change
    </button>
  </div>
);

const EmptyState = ({ filters, onClear, onReport }) => {
  const filtered = filters.categories.length || filters.is24x7 || filters.situations.length || filters.animals.length || filters.services.length || filters.verifiedOnly;
  return (
    <div className="mx-auto max-w-md p-6 text-center">
      <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-ink-200 text-ink-600">
        <SearchIcon size={26} />
      </span>
      <h2 className="text-lg font-bold">No contacts match</h2>
      <p className="mt-1 text-ink-600">
        {filtered
          ? 'Nothing in the directory near you fits these filters yet.'
          : 'No organisations are listed near this location yet.'}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {filtered && (
          <button onClick={onClear} className="btn-ghost w-full">
            Clear filters
          </button>
        )}
        <button onClick={onReport} className="btn-call w-full">
          <HeartIcon size={20} />
          Send a rescue request anyway
        </button>
      </div>
    </div>
  );
};

const Footer = ({ onAdmin }) => (
  <footer className="mt-6 space-y-2 border-t border-ink-200 pt-4 text-center text-xs text-ink-600">
    <p>Map data © OpenStreetMap contributors</p>
    <button onClick={onAdmin} className="underline">
      Admin
    </button>
  </footer>
);
