import { forwardRef, useState } from 'react';
import {
  categoryMeta,
  formatDistance,
  formatServices,
  telHref,
  directionsUrl,
  cx,
} from '../lib/format.js';
import {
  PhoneIcon,
  DirectionsIcon,
  ClockIcon,
  CheckIcon,
  AlertIcon,
  categoryIcon,
  ShieldIcon,
  FlagIcon,
  ConfirmIcon,
} from './icons.jsx';
import { api } from '../lib/api.js';
import { FLAG_REASON_LABELS } from '../lib/flags.js';

/**
 * One result in the list. The two tap targets (Call / Directions) are the whole
 * point of the app, so they are large, first in the tap order, and never
 * obscured by other controls.
 */
const OrgCard = forwardRef(function OrgCard(
  { org, serviceLabels = {}, active = false, onSelect, onCall, showSignals = true },
  ref,
) {
  const meta = categoryMeta(org.category);
  const services = formatServices(org.servicesOffered, serviceLabels);
  const captureOnly = org.servicesOffered.includes('capture_only') && org.servicesOffered.length <= 2;

  const isLive = org.source === 'live';
  // A live OSM clinic often has no phone at all. Directions is then the ONLY
  // useful action, so the button spans the row instead of linking to a
  // non-existent tel: target.
  const hasPhone = Boolean(org.phone);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState({ status: 'idle', message: '' });
  // Crowd signals only make sense for curated entries: they exist to help an
  // admin decide what to verify, and there is no admin queue for OSM data.
  const canSignal = showSignals && !isLive;

  const stop = (fn) => (e) => {
    // The whole card is a click target for the map. Reporting must never also
    // pan the map or clear the selection.
    e.stopPropagation();
    e.preventDefault();
    fn();
  };

  const submitFlag = async (reason) => {
    setBusy(true);
    setState({ status: 'idle', message: '' });
    try {
      const res = await api.flagOrg(org.id, { reason });
      setState({ status: 'done', message: res.message || 'Thanks - an admin will check this.' });
    } catch (err) {
      setState({ status: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const submitConfirm = async () => {
    setBusy(true);
    try {
      const res = await api.confirmOrg(org.id);
      setState({ status: 'done', message: res.message || 'Thanks for confirming.' });
    } catch (err) {
      setState({ status: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li ref={ref} className={cx('scroll-mt-2', active && 'ring-2 ring-brand-600')}>
      <article
        className={cx(
          'card overflow-hidden transition-shadow',
          active ? 'ring-2 ring-brand-600' : 'hover:shadow-md',
        )}
        onClick={() => onSelect?.(org.id)}
      >
        <div className="h-1.5 w-full" style={{ backgroundColor: meta.pin }} />

        <div className="p-4">
          <div className="flex items-start gap-3">
            <span
              className={cx('grid size-11 shrink-0 place-items-center rounded-xl', meta.bg, meta.text)}
              aria-hidden="true"
            >
              {categoryIcon(org.category, { size: 24 })}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cx('text-xs font-bold tracking-wide uppercase', meta.text)}>
                  {meta.fullLabel}
                </span>
                {org.is24x7 && (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700">
                    24x7
                  </span>
                )}
                {isLive ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                    title="Published on OpenStreetMap by mappers. Nobody has phoned to confirm it."
                  >
                    From OpenStreetMap
                  </span>
                ) : org.verified ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800"
                    title={`Verified ${org.lastVerifiedDate || 'recently'}`}
                  >
                    <CheckIcon size={12} /> Verified
                  </span>
                ) : (
                  <span
                    className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-600"
                    title="Listed by us, but the number has not been confirmed by phone."
                  >
                    Listed by us, not yet confirmed
                  </span>
                )}
              </div>

              <h3 className="mt-1 text-lg leading-tight font-bold text-balance">{org.name}</h3>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
                {org.distanceKm != null && (
                  <span className="font-semibold text-ink-800">
                    {formatDistance(org.distanceKm)} away
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <ClockIcon size={14} />
                  {org.is24x7 ? 'Open 24 hours' : org.operatingHours || 'Hours not listed'}
                </span>
              </div>
            </div>
          </div>

          {captureOnly && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-100 p-2.5 text-xs text-ink-700">
              <AlertIcon size={14} className="mt-0.5 shrink-0" />
              <span>
                <strong>Capture only.</strong> This unit removes strays but does not treat injured
                animals. For medical help call a veterinary hospital.
              </span>
            </p>
          )}

          {services.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {services.map((label) => (
                <li
                  key={label}
                  className="rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700"
                >
                  {label}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2.5 text-sm text-ink-600">{org.address}</p>

          {isLive && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
              <AlertIcon size={14} className="mt-0.5 shrink-0" />
              <span>
                <strong>Not phone-verified.</strong> Details come from OpenStreetMap
                contributors and may be outdated. Call ahead if you can.
              </span>
            </p>
          )}

          <div className={cx('mt-4 grid gap-2.5', hasPhone ? 'grid-cols-2' : 'grid-cols-1')}>
            {hasPhone && (
              <a
                href={telHref(org.phone)}
                onClick={() => onCall?.(org)}
                className="btn-call"
                aria-label={`Call ${org.name} at ${org.phone}`}
              >
                <PhoneIcon size={20} />
                Call now
              </a>
            )}
            <a
              href={directionsUrl(org)}
              target="_blank"
              rel="noreferrer"
              className="btn-directions"
              aria-label={`Get directions to ${org.name}`}
            >
              <DirectionsIcon size={20} />
              Directions
            </a>
          </div>

          {canSignal && (
            <div className="mt-2.5 border-t border-ink-200 pt-2.5">
              {!open && !state.message && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={stop(() => setOpen(true))}
                    className="btn-ghost flex-1 text-xs"
                  >
                    <FlagIcon size={14} />
                    Report a problem
                  </button>
                  <button
                    type="button"
                    onClick={stop(submitConfirm)}
                    disabled={busy}
                    className="btn-ghost flex-1 text-xs"
                  >
                    <ConfirmIcon size={14} />
                    Still correct
                  </button>
                </div>
              )}

              {open && !state.message && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-ink-700">What is wrong with this listing?</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(FLAG_REASON_LABELS).map(([reason, label]) => (
                      <button
                        key={reason}
                        type="button"
                        disabled={busy}
                        onClick={stop(() => submitFlag(reason))}
                        className="chip"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={stop(() => setOpen(false))}
                    className="text-xs font-semibold text-ink-600 underline"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {state.message && (
                <p
                  role="status"
                  aria-live="polite"
                  className={cx(
                    'text-xs font-semibold',
                    state.status === 'error' ? 'text-red-700' : 'text-green-700',
                  )}
                >
                  {state.message}
                </p>
              )}
            </div>
          )}

          {org.altPhone && (
            <p className="mt-2 text-center text-xs text-ink-600">
              Alternate:{' '}
              <a href={telHref(org.altPhone)} className="font-semibold underline">
                {org.altPhone}
              </a>
            </p>
          )}

          {org.isSampleData && (
            <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-ink-200 pt-2.5 text-[11px] text-ink-600">
              <ShieldIcon size={12} />
              Sample entry — number not yet confirmed
            </p>
          )}
        </div>
      </article>
    </li>
  );
});

export default OrgCard;
