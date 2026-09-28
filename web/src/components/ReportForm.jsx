import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { cx, telHref, waUrl, waNumber, mapsLink, categoryMeta } from '../lib/format.js';
import {
  WhatsAppIcon,
  CameraIcon,
  CloseIcon,
  CheckIcon,
  AlertIcon,
  SpinnerIcon,
  DirectionsIcon,
  PhoneIcon,
  categoryIcon,
} from './icons.jsx';

const EMPTY = {
  animalType: 'dog',
  situationType: 'injured',
  description: '',
  reporterName: '',
  reporterPhone: '',
};

/**
 * Report a rescue.
 *
 * The MVP "auto-forward" is a pre-filled WhatsApp message: the report is stored
 * on the server, and the user is shown the best-matching organisations with a
 * one-tap wa.me link already containing their own details. This is intentional
 * â€” a human press of send means nobody gets dispatched by accident, and it
 * needs no paid messaging API.
 */
export default function ReportForm({ origin, meta, onSubmitted, onBack, onChangeOrigin }) {
  const [form, setForm] = useState(EMPTY);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);
  const previewUrl = useRef(null);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((f) => ({ ...f, [key]: undefined }));
  };

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setFieldErrors((f) => ({ ...f, photo: 'Photo is too large (max 8 MB)' }));
      return;
    }
    if (!/^image\//.test(file.type)) {
      setFieldErrors((f) => ({ ...f, photo: 'That file is not an image' }));
      return;
    }
    setFieldErrors((f) => ({ ...f, photo: undefined }));
    setPhoto(file);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(file);
    setPhotoPreview(previewUrl.current);
  };

  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreview(null);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    if (fileRef.current) fileRef.current.value = '';
  };

  const validate = () => {
    const errors = {};
    if (form.reporterPhone.trim().length < 6) errors.reporterPhone = 'A contact number is required';
    if (!form.description.trim()) errors.description = 'Describe what you are seeing';
    else if (form.description.trim().length < 10) errors.description = 'Add a little more detail';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const uploadPhoto = async () => {
    if (!photo) return null;
    setUploading(true);
    setUploadPct(0);
    try {
      const res = await api.uploadPhoto(photo, { onProgress: setUploadPct });
      return res.url;
    } catch (err) {
      // A failed photo must never block the report itself â€” the description and
      // location are what actually get a team moving.
      setFieldErrors((f) => ({ ...f, photo: `${err.message} You can still send the report.` }));
      return null;
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    if (!origin) {
      setError('We need your location before sending this. Go back and enable location or pick an area.');
      return;
    }

    setSubmitting(true);
    try {
      const photoUrl = await uploadPhoto();
      const res = await api.createRequest({
        reporterName: form.reporterName.trim() || null,
        reporterPhone: form.reporterPhone.trim(),
        lat: origin.lat,
        lng: origin.lng,
        addressLabel: origin.label || null,
        animalType: form.animalType,
        situationType: form.situationType,
        description: form.description.trim(),
        photoUrl,
      });
      setResult(res);
      onSubmitted?.(res.request);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------------------------------- success view */
  if (result) {
    return (
      <SubmittedView result={result} meta={meta} onBack={onBack} onReset={() => {
        setResult(null);
        setForm(EMPTY);
        clearPhoto();
      }} />
    );
  }

  /* ---------------------------------------------------------- form view */
  const situationOptions = meta?.situationTypes || [];
  const animalOptions = meta?.animalTypes || [];
  const selectedSituation = situationOptions.find((s) => s.id === form.situationType);

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <header className="mb-4 flex items-start gap-3">
        <button type="button" onClick={onBack} aria-label="Go back" className="btn-ghost 3!">
          <CloseIcon size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-bold">Request rescue help</h2>
          <p className="text-sm text-ink-600">
            Your location is attached automatically. An operator will get the details below.
          </p>
        </div>
      </header>

      <form onSubmit={submit} noValidate className="space-y-5">
        {origin && (
          <div className="card flex items-start gap-3 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-700">
              <DirectionsIcon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Your location</p>
              <p className="truncate text-sm text-ink-600">
                {origin.label || `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`}
              </p>
            </div>
            <LocationFixer origin={origin} onChangeOrigin={onChangeOrigin} />
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-base font-bold">What is the situation?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {situationOptions.map((s) => (
              <label
                key={s.id}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white p-3',
                  form.situationType === s.id ? 'border-ink-900' : 'border-ink-200',
                )}
              >
                <input
                  type="radio"
                  name="situationType"
                  value={s.id}
                  checked={form.situationType === s.id}
                  onChange={set('situationType')}
                  className="mt-1 size-5 shrink-0 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{s.label}</span>
                  <span className="block text-xs text-ink-600">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {selectedSituation?.needsMedical && (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-vet-bg p-2.5 text-xs text-vet">
              <AlertIcon size={14} className="mt-0.5 shrink-0" />
              <span>Injured or sick animals need a vet or NGO, not a capture-only municipal unit.</span>
            </p>
          )}
        </fieldset>

        <div>
          <label htmlFor="animalType" className="mb-1.5 block text-base font-bold">
            Animal
          </label>
          <select id="animalType" value={form.animalType} onChange={set('animalType')} className="field">
            {animalOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-base font-bold">
            What is happening?
          </label>
          <textarea
            id="description"
            rows={4}
            required
            value={form.description}
            onChange={set('description')}
            placeholder="e.g. Dog hit by a scooter near the bus stop, bleeding from the leg, cannot walk."
            aria-invalid={!!fieldErrors.description}
            aria-describedby={fieldErrors.description ? 'description-error' : undefined}
            className={cx('field 28!', fieldErrors.description && 'border-vet')}
          />
          {fieldErrors.description && (
            <p id="description-error" className="mt-1 text-sm font-medium text-vet">
              {fieldErrors.description}
            </p>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-base font-bold">Photo (optional)</span>
          {photoPreview ? (
            <div className="relative overflow-hidden rounded-xl">
              <img src={photoPreview} alt="Selected rescue subject" className="h-44 w-full object-cover" />
              <button
                type="button"
                onClick={clearPhoto}
                className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-ink-900/80 text-white"
                aria-label="Remove photo"
              >
                <CloseIcon size={18} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex min-h-24 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-200 bg-white text-ink-600"
            >
              <CameraIcon size={22} />
              Add a photo â€” it helps responders find the animal
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={pickPhoto}
            className="sr-only"
          />
          {uploading && (
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full bg-ink-200">
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
              <p className="mt-1 text-xs font-medium text-ink-600">Uploading photoâ€¦ {uploadPct}%</p>
            </div>
          )}
          {fieldErrors.photo && (
            <p className="mt-1 text-sm font-medium text-vet">{fieldErrors.photo}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="reporterName" className="mb-1.5 block text-base font-bold">
              Your name <span className="font-normal text-ink-600">(optional)</span>
            </label>
            <input
              id="reporterName"
              type="text"
              autoComplete="name"
              value={form.reporterName}
              onChange={set('reporterName')}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="reporterPhone" className="mb-1.5 block text-base font-bold">
              Your phone number
            </label>
            <input
              id="reporterPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={form.reporterPhone}
              onChange={set('reporterPhone')}
              placeholder="98765 43210"
              aria-invalid={!!fieldErrors.reporterPhone}
              className={cx('field', fieldErrors.reporterPhone && 'border-vet')}
            />
            {fieldErrors.reporterPhone && (
              <p className="mt-1 text-sm font-medium text-vet">{fieldErrors.reporterPhone}</p>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-vet-bg p-3 text-sm font-semibold text-vet">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting || uploading} className="btn-call w-full 14! lg!">
          {submitting ? <SpinnerIcon size={22} /> : <CheckIcon size={22} />}
          {submitting ? 'Sendingâ€¦' : 'Send rescue request'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * GPS is wrong more often than people expect: indoors, behind tall buildings,
 * or a stale cached fix from earlier in the day. A request dispatched to the
 * wrong street wastes the rescue team's trip, so the user gets a real way to
 * correct the coordinates rather than a link that opens a map elsewhere.
 */
function LocationFixer({ origin, onChangeOrigin }) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!editing || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await api.searchLocalities(query);
        if (!cancelled) setOptions(res.localities || []);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, editing]);

  if (!onChangeOrigin) {
    return (
      <a
        href={mapsLink(origin.lat, origin.lng)}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-sm font-semibold text-brand-700 underline"
      >
        Fix
      </a>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="tap shrink-0 px-3 text-sm font-semibold text-brand-700 underline"
      >
        Fix
      </button>
    );
  }

  return (
    <div className="shrink-0">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your area"
          aria-label="Correct your location"
          className="min-w-0 flex-1 rounded-lg border border-ink-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setQuery('');
            setMsg('');
          }}
          className="shrink-0 px-2 text-sm font-semibold text-ink-600 underline"
        >
          Cancel
        </button>
      </div>

      {busy && <p className="mt-1 text-xs text-ink-500">Searching…</p>}
      {msg && <p className="mt-1 text-xs text-ink-600">{msg}</p>}

      {options.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-ink-200 bg-white shadow">
          {options.map((o) => (
            <li key={`${o.lat},${o.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onChangeOrigin({
                    lat: o.lat,
                    lng: o.lng,
                    label: o.label,
                    accuracy: null,
                    source: 'manual',
                  });
                  setEditing(false);
                  setQuery('');
                  setOptions([]);
                  setMsg('');
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-ink-50"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!busy && query.trim().length >= 2 && options.length === 0 && (
        <p className="mt-1 text-xs text-ink-500">
          No match. Your description helps the team find you.
        </p>
      )}
    </div>
  );
}

function SubmittedView({ result, meta, onBack, onReset }) {
  const { request, suggestions } = result;
  const matches = suggestions.filter((s) => s.fitScore > 0);
  const others = suggestions.filter((s) => s.fitScore === 0);
  const serviceLabels = Object.fromEntries((meta?.services || []).map((s) => [s.id, s.label]));

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="card mb-4 p-5 text-center">
        <span className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-ngo-bg text-ngo">
          <CheckIcon size={30} />
        </span>
        <h2 className="text-2xl font-bold">Request saved</h2>
        <p className="mt-1 text-ink-600">
          Reference <span className="font-mono font-semibold text-ink-900">{request.id.slice(0, 8)}</span>
        </p>
      </div>

      <div className="mb-4 rounded-xl bg-ink-800 p-4 text-white">
        <p className="text-sm font-semibold">Now send this to a rescue team</p>
        <p className="mt-1 text-sm text-white/80">
          Tap a button below. WhatsApp opens with your message already written â€” just press send.
        </p>
      </div>

      {matches.length > 0 && (
        <Section title="Best match for this situation">
          {matches.map((s) => (
            <SuggestionCard key={s.id} org={s} request={request} serviceLabels={serviceLabels} highlight />
          ))}
        </Section>
      )}

      {others.length > 0 && (
        <Section title="Other contacts nearby">
          {others.map((s) => (
            <SuggestionCard key={s.id} org={s} request={request} serviceLabels={serviceLabels} />
          ))}
        </Section>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <button type="button" onClick={onBack} className="btn-primary w-full">
          Back to nearby contacts
        </button>
        <button type="button" onClick={onReset} className="btn-ghost w-full">
          Report another animal
        </button>
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <section className="mb-4">
    <h3 className="mb-2 text-sm font-bold tracking-wide text-ink-600 uppercase">{title}</h3>
    <ul className="space-y-3">{children}</ul>
  </section>
);

function SuggestionCard({ org, request, serviceLabels, highlight }) {
  const meta = categoryMeta(org.category);
  const number = org.waNumber || waNumber(org.whatsapp || org.phone);
  // The server already composed this text (it owns the format so the admin
  // preview and the real send can never drift). Only fall back to a link if an
  // older cached response is missing it.
  const message = org.message || `Rescue request ${request.id} at ${request.lat}, ${request.lng}`;

  return (
    <li className={cx('card p-4', highlight && 'ring-2 ring-brand-600')}>
      <div className="flex items-start gap-3">
        <span
          className={cx('grid size-10 shrink-0 place-items-center rounded-xl', meta.bg, meta.text)}
          aria-hidden="true"
        >
          {categoryIcon(org.category, { size: 22 })}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cx('text-xs font-bold uppercase', meta.text)}>{meta.fullLabel}</p>
          <h4 className="text-base leading-tight font-bold">{org.name}</h4>
          <p className="mt-0.5 text-sm text-ink-600">
            {org.is24x7 ? 'Open 24 hours' : 'Check hours before travelling'}
            {org.distanceKm != null && ` Â· ${org.distanceKm} km away`}
          </p>
          {org.servicesOffered?.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-600">
              Offers: {org.servicesOffered.map((s) => serviceLabels[s] || s).join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {number ? (
          <a
            href={waUrl(number, message)}
            target="_blank"
            rel="noreferrer"
            className="tap bg-[#25D366] font-bold text-white active:bg-[#1DA851]"
          >
            <WhatsAppIcon size={20} />
            Send on WhatsApp
          </a>
        ) : (
          <span className="tap cursor-not-allowed bg-ink-200 text-ink-600">No WhatsApp number</span>
        )}
        <a href={telHref(org.phone)} className="btn-call">
          <PhoneIcon size={20} />
          Call instead
        </a>
      </div>
    </li>
  );
}
