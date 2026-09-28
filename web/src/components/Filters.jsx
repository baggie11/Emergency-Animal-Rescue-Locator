import { useMemo, useState } from 'react';
import { cx, categoryMeta } from '../lib/format.js';
import { categoryIcon, ClockIcon, SearchIcon, CloseIcon } from './icons.jsx';

/**
 * Filter chips.
 *
 * Category and 24x7 are single-select; situation and animal are multi-select,
 * because a real case is often "injured cat" rather than one or the other.
 * Keeping the two kinds visually distinct stops people setting contradictory
 * combinations.
 */
export default function Filters({
  categories,
  meta,
  filters,
  onChange,
  resultCount,
  totalCount,
  onClear,
}) {
  const categoryOptions = meta?.categories || categories;
  const serviceLabels = useMemo(
    () => Object.fromEntries((meta?.services || []).map((s) => [s.id, s.label])),
    [meta],
  );
  const animalOptions = meta?.animalTypes || [];
  const situationOptions = meta?.situationTypes || [];
  const [open, setOpen] = useState(false);

  const toggle = (key, value) => {
    const current = filters[key];
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };

  const setSingle = (key, value) => onChange({ ...filters, [key]: value });

  const activeCount =
    (filters.categories.length ? 1 : 0) +
    (filters.is24x7 ? 1 : 0) +
    (filters.verifiedOnly ? 1 : 0) +
    filters.situations.length +
    filters.animals.length +
    (filters.services.length ? 1 : 0);

  return (
    <div className="sticky top-0 z-20 border-b border-ink-200 bg-ink-100/95 backdrop-blur">
      {/* Category row — always visible, this is the primary decision. */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <CategoryChip
          label="All"
          active={filters.categories.length === 0}
          onClick={() => setSingle('categories', [])}
        />
        {categoryOptions.map((c) => {
          const m = categoryMeta(c.id);
          const on = filters.categories.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle('categories', c.id)}
              aria-pressed={on}
              className={cx('chip', on && 'ring-2', on ? 'text-white' : '')}
              style={on ? { backgroundColor: m.pin, borderColor: m.pin } : undefined}
            >
              <span className={on ? 'text-white' : m.text}>{categoryIcon(c.id, { size: 16 })}</span>
              {c.shortLabel}
            </button>
          );
        })}

        <span className="mx-0.5 w-px shrink-0 bg-ink-200" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setSingle('is24x7', !filters.is24x7)}
          aria-pressed={filters.is24x7}
          className={cx('chip', filters.is24x7 && 'chip-on')}
        >
          <ClockIcon size={16} />
          24x7 only
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cx('chip', open && 'ring-2 ring-ink-900', activeCount > 0 && !open && 'ring-2 ring-brand-600')}
        >
          <SearchIcon size={16} />
          More
          {activeCount > 0 && (
            <span className="ml-0.5 grid size-5 place-items-center rounded-full bg-brand-600 text-xs text-white">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="max-h-[55vh] space-y-4 overflow-y-auto border-t border-ink-200 bg-white px-4 py-4">
          <Group
            title="Situation"
            hint="Municipal units often only capture — they may not treat injuries."
          >
            {situationOptions.map((s) => (
              <Chip
                key={s.id}
                label={s.label}
                hint={s.hint}
                on={filters.situations.includes(s.id)}
                onClick={() => toggle('situations', s.id)}
              />
            ))}
          </Group>

          <Group title="Animal">
            {animalOptions.map((a) => (
              <Chip
                key={a.id}
                label={a.label}
                on={filters.animals.includes(a.id)}
                onClick={() => toggle('animals', a.id)}
              />
            ))}
          </Group>

          <Group title="Service needed">
            {Object.entries(serviceLabels).map(([id, label]) => (
              <Chip
                key={id}
                label={label}
                on={filters.services.includes(id)}
                onClick={() => toggle('services', id)}
              />
            ))}
          </Group>

          <fieldset>
            <legend className="text-sm font-bold text-ink-800">Trust</legend>
            <p className="mt-0.5 mb-2 text-xs text-ink-600">
              Live OpenStreetMap clinics are never phone-verified, so they are
              hidden when this is on. Use it when you cannot afford to call ahead.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip
                label="Verified only"
                on={filters.verifiedOnly}
                onClick={() => onChange({ ...filters, verifiedOnly: !filters.verifiedOnly })}
              />
            </div>
          </fieldset>

          <button type="button" onClick={onClear} className="btn-ghost w-full">
            <CloseIcon size={18} />
            Clear all filters
          </button>
        </div>
      )}

      <p className="px-4 pb-2 text-xs font-medium text-ink-600" role="status" aria-live="polite">
        {resultCount === totalCount
          ? `${resultCount} contact${resultCount === 1 ? '' : 's'} near you`
          : `${resultCount} of ${totalCount} contacts match your filters`}
      </p>
    </div>
  );
}

function Group({ title, hint, children }) {
  return (
    <fieldset>
      <legend className="text-sm font-bold text-ink-800">{title}</legend>
      {hint && <p className="mt-0.5 mb-2 text-xs text-ink-600">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

const CategoryChip = ({ label, active, onClick }) => (
  <button type="button" onClick={onClick} aria-pressed={active} className={cx('chip', active && 'chip-on')}>
    {label}
  </button>
);

const Chip = ({ label, hint, on, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    title={hint}
    className={cx('chip', on && 'chip-on')}
  >
    {label}
  </button>
);
