import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { categoryMeta, daysSince, relativeTime, cx, telHref, directionsUrl } from '../lib/format.js';
import {
  PlusIcon,
  TrashIcon,
  EditIcon,
  CheckIcon,
  CloseIcon,
  SpinnerIcon,
  ShieldIcon,
  categoryIcon,
  SearchIcon,
  AlertIcon,
  FlagIcon,
} from './icons.jsx';
import { FLAG_REASON_LABELS } from '../lib/flags.js';

/**
 * Admin panel: manage the directory and the incoming request queue.
 *
 * Data quality is treated as a first-class concern: every row shows when it was
 * last verified, and unverified or stale entries are surfaced first so someone
 * actually picks up the phone and re-checks them.
 */
export default function AdminPanel({ meta }) {
  const [auth, setAuth] = useState({ state: 'checking', user: null });
  const [tab, setTab] = useState('directory');

  useEffect(() => {
    api
      .session()
      .then((s) => setAuth({ state: s.authenticated ? 'in' : 'out', user: s.user }))
      .catch(() => setAuth({ state: 'out', user: null }));
  }, []);

  const signOut = async () => {
    await api.logout().catch(() => {});
    setAuth({ state: 'out', user: null });
  };

  if (auth.state === 'checking') {
    return (
      <Centered>
        <SpinnerIcon size={28} className="text-ink-600" />
        <p className="mt-3 text-ink-600">Checking sessionâ€¦</p>
      </Centered>
    );
  }

  if (auth.state === 'out') {
    return <LoginForm onSuccess={(user) => setAuth({ state: 'in', user })} />;
  }

  return (
    <div className="min-h-dvh bg-ink-100 pb-16">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <ShieldIcon size={22} className="text-ink-700" />
          <h1 className="flex-1 text-lg font-bold">Admin â€” Rescue Nearby</h1>
          <span className="hidden text-sm text-ink-600 sm:inline">{auth.user?.username}</span>
          <button type="button" onClick={signOut} className="btn-ghost 10! 3! sm!">
            Sign out
          </button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-2">
          {[
            ['directory', 'Organisations'],
            ['requests', 'Rescue requests'],
            ['settings', 'Settings'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cx(
                'min-h-11 flex-1 border-b-3 text-sm font-semibold',
                tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-600',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl p-4">
        {tab === 'directory' && <DirectoryTab meta={meta} />}
        {tab === 'requests' && <RequestsTab meta={meta} />}
        {tab === 'settings' && <SettingsTab meta={meta} />}
      </main>
    </div>
  );
}

const Centered = ({ children }) => (
  <div className="grid min-h-dvh place-items-center bg-ink-100 px-4">{children}</div>
);

/* ------------------------------------------------------------------ login */

function LoginForm({ onSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      onSuccess(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-900 px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-bold">Admin sign in</h1>
        <p className="mt-1 mb-5 text-sm text-ink-600">
          Managing the directory requires a password. Public users never need to sign in.
        </p>

        <label htmlFor="username" className="mb-1 block text-sm font-semibold">
          Username
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="field mb-4"
        />

        <label htmlFor="password" className="mb-1 block text-sm font-semibold">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="field"
        />

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-vet-bg p-2.5 text-sm font-semibold text-vet">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
          {busy ? <SpinnerIcon size={20} /> : null}
          Sign in
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------- directory */

const STALE_AFTER_DAYS = 180;

function DirectoryTab({ meta }) {
  const orgs = useAsync(() => api.listOrgs(), []);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const rows = useMemo(() => {
    const list = orgs.data?.organizations || [];
    const q = query.trim().toLowerCase();
    return list
      .filter((o) => (categoryFilter ? o.category === categoryFilter : true))
      .filter((o) =>
        q
          ? [o.name, o.address, o.city, o.phone].some((f) => String(f || '').toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => {
        // Rank 0 is the top of the queue. A public report outranks our own
        // ageing data: someone standing outside the building is a stronger
        // signal than a date we let slip 8 months ago.
        const rank = (o) => {
          let score = 0;
          if (!o.active) score += 8;
          if (o.flagCount > 0) score -= 6;
          if (!o.verified) score += 1;
          if (isStale(o)) score += 0.5;
          return score;
        };
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  }, [orgs.data, query, categoryFilter]);

  const needsAttention = (orgs.data?.organizations || []).filter(
    (o) => o.active && (o.flagCount > 0 || !o.verified || isStale(o)),
  ).length;
  const flaggedCount = (orgs.data?.organizations || []).filter((o) => o.flagCount > 0).length;

  const remove = async (org) => {
    if (!window.confirm(`Delete â€œ${org.name}â€ permanently? Deactivating is usually safer.`)) return;
    await api.deleteOrg(org.id);
    orgs.run();
  };

  const toggleFlag = async (org, field) => {
    await api.updateOrg(org.id, { [field]: !org[field] });
    orgs.run();
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, city, phoneâ€¦"
            aria-label="Search organisations"
            className="field pl-10"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          className="field sm:w-52"
        >
          <option value="">All categories</option>
          {(meta?.categories || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullLabel}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setEditing({})} className="btn-primary shrink-0">
          <PlusIcon size={20} />
          Add
        </button>
      </div>

      {flaggedCount > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <FlagIcon size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>
              {flaggedCount} {flaggedCount === 1 ? 'listing has' : 'listings have'} been
              reported as wrong by the public.
            </strong>{' '}
            These are at the top of the list. Call the number, then either fix it or
            deactivate it — do not just dismiss the report.
          </span>
        </p>
      )}

      {needsAttention > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-700">
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>
              {needsAttention} active {needsAttention === 1 ? 'entry needs' : 'entries need'} verification.
            </strong>{' '}
            Call the number, confirm it still works, then tick Verified. People are relying on these
            details in an emergency.
          </span>
        </p>
      )}

      {editing && (
        <OrgForm
          org={editing}
          meta={meta}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            orgs.run();
          }}
        />
      )}

      {orgs.loading && (
        <p className="flex items-center gap-2 py-8 text-ink-600">
          <SpinnerIcon size={20} /> Loading directoryâ€¦
        </p>
      )}

      {orgs.error && (
        <p className="rounded-xl bg-vet-bg p-3 font-semibold text-vet">{orgs.error}</p>
      )}

      {rows.length === 0 && !orgs.loading && (
        <p className="py-8 text-center text-ink-600">No organisations match this view.</p>
      )}

      <ul className="space-y-2">
        {rows.map((org) => (
          <li key={org.id} className={cx('card p-3', !org.active && 'opacity-60')}>
            <div className="flex items-start gap-3">
              <span
                className={cx(
                  'grid size-9 shrink-0 place-items-center rounded-lg',
                  categoryMeta(org.category).bg,
                  categoryMeta(org.category).text,
                )}
                aria-hidden="true"
              >
                {categoryIcon(org.category, { size: 18 })}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold">{org.name}</h3>
                  {org.is24x7 && (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                      24x7
                    </span>
                  )}
                  {!org.active && (
                    <span className="rounded-full bg-ink-200 px-2 py-0.5 text-[11px] font-bold text-ink-700">
                      Inactive
                    </span>
                  )}
                  {org.isSampleData && (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                      Sample
                    </span>
                  )}
                  {org.flagCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800"
                      title={FLAG_REASON_LABELS[org.latestFlagReason] || org.latestFlagReason}
                    >
                      <FlagIcon size={11} />
                      Reported {org.flagCount}x
                      {org.latestFlagReason
                        ? ` — ${FLAG_REASON_LABELS[org.latestFlagReason] || org.latestFlagReason}`
                        : ''}
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-600">
                  {categoryMeta(org.category).fullLabel} Â· {org.city}
                  {org.distanceKm == null ? '' : ''}
                </p>
                <p className="text-sm">
                  <a href={telHref(org.phone)} className="font-semibold text-brand-700 underline">
                    {org.phone}
                  </a>
                  {org.lastVerifiedDate && (
                    <span className={cx('ml-2', isStale(org) ? 'font-semibold text-vet' : 'text-ink-600')}>
                      {isStale(org) ? 'Stale â€”' : 'Verified'} {org.lastVerifiedDate}
                      {isStale(org) && ` (${daysSince(org.lastVerifiedDate)}d)`}
                    </span>
                  )}
                </p>
                {org.servicesOffered.length > 0 && (
                  <p className="mt-1 text-xs text-ink-600">
                    {org.servicesOffered.map((s) => meta?.services?.find((x) => x.id === s)?.label || s).join(' · ')}
                  </p>
                )}
                {org.confirmationCount > 0 && (
                  <p className="mt-1 text-xs text-green-700">
                    {org.confirmationCount} public confirmation{org.confirmationCount === 1 ? '' : 's'}
                    {org.lastConfirmedAt ? ` · last ${org.lastConfirmedAt}` : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Toggle on={org.verified} onClick={() => toggleFlag(org, 'verified')} label="Verified" />
              <Toggle on={org.active} onClick={() => toggleFlag(org, 'active')} label="Active" />
              <button type="button" onClick={() => setEditing(org)} className="btn-ghost 9! 2.5! xs!">
                <EditIcon size={14} /> Edit
              </button>
              <a
                href={directionsUrl(org)}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost 9! 2.5! xs!"
              >
                Map
              </a>
              <button
                type="button"
                onClick={() => remove(org)}
                className="btn-ghost 9! 2.5! xs! vet!"
              >
                <TrashIcon size={14} /> Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const isStale = (org) => {
  const d = daysSince(org.lastVerifiedDate);
  return d != null && d > STALE_AFTER_DAYS;
};

const Toggle = ({ on, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={cx(
      'inline-flex min-h-9 items-center gap-1 rounded-lg border-2 px-2.5 text-xs font-bold',
      on ? 'border-ngo bg-ngo-bg text-ngo' : 'border-ink-200 bg-white text-ink-600',
    )}
  >
    {on && <CheckIcon size={13} />}
    {label}
  </button>
);

/* ------------------------------------------------------------- org form */

const BLANK_ORG = {
  name: '',
  category: 'ngo',
  phone: '',
  altPhone: '',
  whatsapp: '',
  email: '',
  website: '',
  address: '',
  city: '',
  state: 'Tamil Nadu',
  lat: '',
  lng: '',
  servicesOffered: [],
  animalTypesHandled: [],
  is24x7: false,
  operatingHours: '',
  verified: false,
  notes: '',
  isSampleData: false,
};

function OrgForm({ org, meta, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...BLANK_ORG, ...org }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState(null);
  const isNew = !org.id;

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleIn = (key) => (value) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setApiError(null);
    try {
      const payload = {
        ...form,
        lat: Number(form.lat),
        lng: Number(form.lng),
        altPhone: form.altPhone || null,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        website: form.website || null,
        operatingHours: form.operatingHours || null,
        notes: form.notes || null,
      };
      if (isNew) await api.createOrg(payload);
      else await api.updateOrg(form.id, payload);
      onSaved();
    } catch (err) {
      setApiError(err.message);
      if (err.details) setErrors({});
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/60 p-0 sm:p-6">
      <form
        onSubmit={submit}
        noValidate
        className="mx-auto min-h-dvh w-full max-w-2xl bg-white p-5 sm:min-h-0 sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center gap-3">
          <h2 className="flex-1 text-xl font-bold">{isNew ? 'Add organisation' : 'Edit organisation'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-ghost 3!">
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Name" required error={errors.name}>
            <input value={form.name} onChange={set('name')} required className="field" />
          </Field>

          <Field label="Category" required>
            <select value={form.category} onChange={set('category')} className="field">
              {(meta?.categories || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullLabel}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" required error={errors.phone}>
              <input value={form.phone} onChange={set('phone')} type="tel" required className="field" />
            </Field>
            <Field label="Alternate phone" error={errors.altPhone}>
              <input value={form.altPhone} onChange={set('altPhone')} type="tel" className="field" />
            </Field>
            <Field label="WhatsApp" hint="Number only, digits, with country code" error={errors.whatsapp}>
              <input
                value={form.whatsapp}
                onChange={set('whatsapp')}
                inputMode="numeric"
                placeholder="919840000001"
                className="field"
              />
            </Field>
            <Field label="Email" error={errors.email}>
              <input value={form.email} onChange={set('email')} type="email" className="field" />
            </Field>
          </div>

          <Field label="Website" error={errors.website}>
            <input value={form.website} onChange={set('website')} placeholder="https://" className="field" />
          </Field>

          <Field label="Address" required error={errors.address}>
            <input value={form.address} onChange={set('address')} required className="field" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" required error={errors.city}>
              <input value={form.city} onChange={set('city')} required className="field" />
            </Field>
            <Field label="State" required error={errors.state}>
              <input value={form.state} onChange={set('state')} required className="field" />
            </Field>
            <Field label="Latitude" required error={errors.lat} hint="-90 to 90">
              <input value={form.lat} onChange={set('lat')} inputMode="decimal" required className="field" />
            </Field>
            <Field label="Longitude" required error={errors.lng} hint="-180 to 180">
              <input value={form.lng} onChange={set('lng')} inputMode="decimal" required className="field" />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-bold">Services offered</legend>
            <div className="flex flex-wrap gap-2">
              {(meta?.services || []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleIn('servicesOffered')(s.id)}
                  aria-pressed={form.servicesOffered.includes(s.id)}
                  className={cx('chip 9! xs!', form.servicesOffered.includes(s.id) && 'chip-on')}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-bold">Animals handled</legend>
            <div className="flex flex-wrap gap-2">
              {(meta?.animalTypes || []).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleIn('animalTypesHandled')(a.id)}
                  aria-pressed={form.animalTypesHandled.includes(a.id)}
                  className={cx('chip 9! xs!', form.animalTypesHandled.includes(a.id) && 'chip-on')}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border-2 border-ink-200 p-3">
              <input
                type="checkbox"
                checked={form.is24x7}
                onChange={(e) => setForm((f) => ({ ...f, is24x7: e.target.checked }))}
                className="size-5 accent-brand-600"
              />
              <span className="font-semibold">Open 24x7</span>
            </label>
            <label className="flex items-center gap-3 rounded-xl border-2 border-ink-200 p-3">
              <input
                type="checkbox"
                checked={form.verified}
                onChange={(e) => setForm((f) => ({ ...f, verified: e.target.checked }))}
                className="size-5 accent-brand-600"
              />
              <span className="font-semibold">Verified</span>
            </label>
          </div>

          <Field label="Operating hours" hint="e.g. 9:00 AM - 6:00 PM">
            <input value={form.operatingHours} onChange={set('operatingHours')} className="field" />
          </Field>

          <Field label="Notes" hint="Anything a responder should know">
            <textarea value={form.notes} onChange={set('notes')} rows={3} className="field 20!" />
          </Field>
        </div>

        {apiError && (
          <p role="alert" className="mt-4 rounded-xl bg-vet-bg p-3 font-semibold text-vet">
            {apiError}
          </p>
        )}

        <div className="sticky bottom-0 -mx-5 mt-6 flex gap-2 border-t border-ink-200 bg-white px-5 py-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">
            {busy ? <SpinnerIcon size={20} /> : <CheckIcon size={20} />}
            {isNew ? 'Create' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

const Field = ({ label, hint, required, error, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-sm font-bold">
      {label}
      {required && <span className="text-vet"> *</span>}
    </span>
    {children}
    {hint && !error && <span className="mt-1 block text-xs text-ink-600">{hint}</span>}
    {error && <span className="mt-1 block text-xs font-semibold text-vet">{error}</span>}
  </label>
);

/* -------------------------------------------------------------- requests */

const STATUS_LABELS = {
  new: 'New',
  forwarded: 'Forwarded',
  resolved: 'Resolved',
  declined: 'Declined',
};

function RequestsTab({ meta }) {
  const [status, setStatus] = useState('');
  const queue = useAsync(() => api.requestQueue(status || undefined), [status]);
  const orgs = useAsync(() => api.listOrgs(), []);

  const setReqStatus = async (id, next, forwardedTo) => {
    await api.setRequestStatus(id, { status: next, ...(forwardedTo ? { forwardedTo } : {}) });
    queue.run();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {['', 'new', 'forwarded', 'resolved', 'declined'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={cx('chip', status === s && 'chip-on')}
          >
            {s === '' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {queue.loading && (
        <p className="flex items-center gap-2 py-8 text-ink-600">
          <SpinnerIcon size={20} /> Loading requestsâ€¦
        </p>
      )}
      {queue.error && <p className="rounded-xl bg-vet-bg p-3 font-semibold text-vet">{queue.error}</p>}

      {queue.data?.requests?.length === 0 && (
        <p className="py-8 text-center text-ink-600">No requests here.</p>
      )}

      <ul className="space-y-3">
        {(queue.data?.requests || []).map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-bold text-ink-700">
                {STATUS_LABELS[r.status]}
              </span>
              <span className="text-xs text-ink-600">{relativeTime(r.createdAt)}</span>
              <span className="ml-auto font-mono text-xs text-ink-600">{r.id.slice(0, 8)}</span>
            </div>

            <h3 className="mt-2 font-bold">
              {r.situationTypeLabel} Â· {r.animalTypeLabel}
            </h3>
            <p className="text-sm text-ink-700">{r.description}</p>

            <p className="mt-2 text-sm text-ink-600">
              {r.reporterName || 'Anonymous'} Â·{' '}
              <a href={telHref(r.reporterPhone)} className="font-semibold text-brand-700 underline">
                {r.reporterPhone}
              </a>
            </p>
            <p className="text-sm">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand-700 underline"
              >
                {r.addressLabel || `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`}
              </a>
            </p>

            {r.photoUrl && (
              <a href={r.photoUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                <img
                  src={r.photoUrl}
                  alt="Submitted rescue subject"
                  className="max-h-48 rounded-lg object-cover"
                />
              </a>
            )}

            {r.forwardedToName && (
              <p className="mt-2 text-sm font-semibold text-ngo">Forwarded to {r.forwardedToName}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.status !== 'forwarded' && (
                <select
                  value=""
                  onChange={(e) => e.target.value && setReqStatus(r.id, 'forwarded', e.target.value)}
                  aria-label={`Forward ${r.id} to an organisation`}
                  className="field 9! auto! 1! xs!"
                >
                  <option value="">Mark as forwarded toâ€¦</option>
                  {(orgs.data?.organizations || [])
                    .filter((o) => o.active)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              )}
              {r.status !== 'resolved' && (
                <button
                  type="button"
                  onClick={() => setReqStatus(r.id, 'resolved')}
                  className="btn-ghost 9! 2.5! xs!"
                >
                  <CheckIcon size={14} /> Mark resolved
                </button>
              )}
              {r.status !== 'declined' && (
                <button
                  type="button"
                  onClick={() => setReqStatus(r.id, 'declined')}
                  className="btn-ghost 9! 2.5! xs!"
                >
                  <CloseIcon size={14} /> Declined
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* -------------------------------------------------------------- settings */

function SettingsTab({ meta }) {
  const cfg = useAsync(() => api.config(), []);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cfg.data?.config && !form) setForm(cfg.data.config);
  }, [cfg.data, form]);

  if (!form) return <p className="py-8 text-ink-600">Loading settingsâ€¦</p>;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateConfig(form);
      setForm(res.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="card max-w-2xl space-y-4 p-5">
      <h2 className="text-lg font-bold">Public settings</h2>
      <p className="text-sm text-ink-600">
        These are shown to every user on the home screen banner. Editable here so the helpline
        number can be corrected without a code deploy.
      </p>

      <Field label="Helpline label" required>
        <input
          value={form.helplineLabel || ''}
          onChange={(e) => setForm((f) => ({ ...f, helplineLabel: e.target.value }))}
          className="field"
        />
      </Field>

      <Field label="Helpline phone" required hint="Digits only, e.g. 112 or 044-12345678">
        <input
          value={form.helplinePhone || ''}
          onChange={(e) => setForm((f) => ({ ...f, helplinePhone: e.target.value }))}
          inputMode="tel"
          className="field"
        />
      </Field>

      <Field label="Helpline note" hint="Shown as a warning strip while sample-data mode is on">
        <textarea
          value={form.helplineNote || ''}
          onChange={(e) => setForm((f) => ({ ...f, helplineNote: e.target.value }))}
          rows={2}
          className="field 20!"
        />
      </Field>

      <Field label="Data disclaimer" hint="Shown under the results list">
        <textarea
          value={form.dataDisclaimer || ''}
          onChange={(e) => setForm((f) => ({ ...f, dataDisclaimer: e.target.value }))}
          rows={2}
          className="field 20!"
        />
      </Field>

      <label className="flex items-start gap-3 rounded-xl border-2 border-brand-200 bg-brand-50 p-3">
        <input
          type="checkbox"
          checked={form.isSampleData === 'true'}
          onChange={(e) => setForm((f) => ({ ...f, isSampleData: e.target.checked ? 'true' : 'false' }))}
          className="mt-0.5 size-5 accent-brand-600"
        />
        <span>
          <span className="block font-bold">Directory is sample data</span>
          <span className="block text-sm text-ink-700">
            Keeps the â€œsample entryâ€ warnings visible. Only turn this off once every organisation
            has been verified by phone.
          </span>
        </span>
      </label>

      {error && <p className="rounded-xl bg-vet-bg p-3 font-semibold text-vet">{error}</p>}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? <SpinnerIcon size={20} /> : saved ? <CheckIcon size={20} /> : null}
        {saved ? 'Saved' : 'Save settings'}
      </button>
    </form>
  );
}
