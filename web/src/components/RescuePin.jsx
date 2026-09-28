import { categoryMeta, cx } from '../lib/format.js';

/**
 * A teardrop pin drawn as inline SVG so it can be tinted per category without
 * shipping three sprite images. Returned as an HTML string because Leaflet's
 * divIcon takes HTML.
 */
export function pinHtml({ category, is24x7, active = false, rank = null, source = 'curated' }) {
  const { pin: fill } = categoryMeta(category);
  const isLive = source === 'live';
  const ring = active ? '#0f172a' : 'rgba(255,255,255,0.95)';
  const ringWidth = active ? 3 : 2.5;

  // A dashed outline marks a live OpenStreetMap result. On a map the user is
  // scanning for somewhere to go right now, "is this confirmed?" matters, and
  // a dash reads as provisional without needing a legend.
  const dash = isLive && !active ? ' stroke-dasharray="3 2.5"' : '';

  const badge = is24x7
    ? `<circle cx="29" cy="10" r="7" fill="#f97316" stroke="white" stroke-width="2"/>`
    : '';

  const label = rank != null && rank <= 3
    ? `<text x="15" y="27" font-family="system-ui, sans-serif" font-size="13" font-weight="700"
         fill="white" text-anchor="middle">${rank}</text>`
    : '';

  return `
    <svg class="rescue-pin ${active ? 'rescue-pin--active' : ''} ${isLive ? 'rescue-pin--live' : ''}"
         viewBox="0 0 30 44" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 13.6 27.3 14.2 28a1 1 0 0 0 1.6 0C16.4 42.3 30 25.5 30 15 30 6.7 23.3 0 15 0Z"
            fill="${fill}" stroke="${ring}" stroke-width="${ringWidth}"${dash}/>
      <circle cx="15" cy="15" r="8" fill="rgba(255,255,255,0.22)"/>
      ${label}
      ${badge}
    </svg>
  `;
}

export const pinWrapperClass = (active) =>
  cx('flex items-end justify-center', active ? 'z-[1000]' : '');
