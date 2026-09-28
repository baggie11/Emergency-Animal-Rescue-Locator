/** Presentation helpers shared across the list, map and cards. */

export const CATEGORY_META = {
  ngo: {
    label: 'NGO',
    fullLabel: 'NGO / Rescue group',
    text: 'text-ngo',
    bg: 'bg-ngo-bg',
    ring: 'ring-ngo',
    pin: '#15803d',
  },
  veterinary: {
    label: 'Vet',
    fullLabel: 'Veterinary',
    text: 'text-vet',
    bg: 'bg-vet-bg',
    ring: 'ring-vet',
    pin: '#b91c1c',
  },
  municipal: {
    label: 'Municipal',
    fullLabel: 'Municipal / Animal control',
    text: 'text-muni',
    bg: 'bg-muni-bg',
    ring: 'ring-muni',
    pin: '#1d4ed8',
  },
};

export const categoryMeta = (category) =>
  CATEGORY_META[category] || {
    label: 'Other',
    fullLabel: 'Other',
    text: 'text-ink-700',
    bg: 'bg-ink-100',
    ring: 'ring-ink-400',
    pin: '#475569',
  };

/** Metres below 1 km, one decimal up to 10 km, whole km beyond. */
export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return null;
  if (km < 1) return `${Math.max(Math.round(km * 1000), 50)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatServices(slugs = [], labels = {}) {
  if (!slugs.length) return [];
  return slugs.map((slug) => labels[slug] || slug.replace(/_/g, ' '));
}

/**
 * Strips a `tel:` link down to the digits a phone will dial. Tel links must not
 * contain spaces, dashes or a leading +.
 */
export function telHref(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, '');
  return `tel:${digits}`;
}

/**
 * Directions deep link. Google Maps on every platform (it falls back to Apple
 * Maps on iOS when Google Maps is not installed), plus an Apple-specific branch
 * for iOS users who prefer it.
 */
export function directionsUrl(org, { prefer = 'auto' } = {}) {
  const q = `${org.lat},${org.lng}`;
  const name = encodeURIComponent(org.name);
  if (prefer === 'apple') {
    return `https://maps.apple.com/?q=${name}&ll=${q}&dirflg=d`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function waUrl(number, text) {
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text || '')}`;
}

/** Strips + and leading zeros so tel: links dial cleanly. */
export function waNumber(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `91${digits}` : digits;
}

export const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export function relativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const diff = Date.now() - then.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString();
}

export const cx = (...parts) => parts.filter(Boolean).join(' ');

/** Rough staleness flag for the admin list, in days. */
export function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(`${dateStr}T00:00:00`);
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}
