import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { pinHtml } from './RescuePin.jsx';
import { categoryMeta } from '../lib/format.js';

/**
 * Leaflet map of the results list.
 *
 * Plain Leaflet rather than react-leaflet: the marker set is a simple derived
 * array, and going direct avoids a wrapper library and its React version
 * coupling. Markers are diffed manually so panning does not recreate them.
 */
export default function RescueMap({
  results = [],
  origin = null,
  selectedId = null,
  onSelect,
  className = '',
  center,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const originMarkerRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* ------------------------------------------------------ create once */
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const start = center || origin || { lat: 13.0827, lng: 80.2707 };
    const map = L.map(containerRef.current, {
      center: [start.lat, start.lng],
      zoom: origin ? 13 : 11,
      zoomControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    mapRef.current = map;

    // Leaflet mis-measures if it initialises inside a hidden/zero-size parent,
    // which is exactly what happens when this is behind a mobile tab.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      // Must be nulled too: a marker belongs to the map instance that created
      // it, so a stale ref would make the next effect mutate a dead marker.
      originMarkerRef.current = null;
    };
    // Intentionally create the map once; subsequent moves are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------- keep the user on origin */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !origin) return;
    map.setView([origin.lat, origin.lng], Math.max(map.getZoom(), 13), { animate: false });

    if (originMarkerRef.current) {
      originMarkerRef.current.setLatLng([origin.lat, origin.lng]);
      return;
    }
    originMarkerRef.current = L.marker([origin.lat, origin.lng], {
      interactive: false,
      icon: L.divIcon({
        className: '',
        html: `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
                 <circle cx="11" cy="11" r="9" fill="#2563eb" fill-opacity="0.25" stroke="white" stroke-width="2"/>
                 <circle cx="11" cy="11" r="4.5" fill="#2563eb" stroke="white" stroke-width="1.5"/>
               </svg>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    }).addTo(map);
  }, [origin]);

  /* ------------------------------------------------- sync result pins */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set();
    const bounds = [];

    results.forEach((org, index) => {
      seen.add(org.id);
      const latLng = [org.lat, org.lng];
      bounds.push(latLng);

      const existing = markersRef.current.get(org.id);
      if (existing) {
        existing.setLatLng(latLng);
        // Replace the icon only when something visible changed.
        if (
          existing.options.__rank !== index + 1 ||
          existing.options.__active !== (org.id === selectedId) ||
          existing.options.__source !== (org.source || 'curated')
        ) {
          const wasZ = existing.getZIndexOffset();
          const marker = existing.setIcon(buildIcon(org, index + 1, org.id === selectedId));
          marker.options.__rank = index + 1;
          marker.options.__active = org.id === selectedId;
          marker.options.__source = org.source || 'curated';
          marker.setZIndexOffset(wasZ);
          markersRef.current.set(org.id, marker);
        }
        return;
      }

      const marker = L.marker(latLng, {
        icon: buildIcon(org, index + 1, org.id === selectedId),
        riseOnHover: true,
        title: org.name,
        alt: `${org.name}, ${categoryMeta(org.category).fullLabel}`,
        keyboard: true,
      }).addTo(map);

      marker.options.__rank = index + 1;
      marker.options.__active = org.id === selectedId;
      marker.options.__source = org.source || 'curated';
      marker.on('click', () => onSelectRef.current?.(org.id));
      marker.bindPopup(popupHtml(org), { closeButton: true, autoPan: true });
      markersRef.current.set(org.id, marker);
    });

    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Fit to the results only when the user has not actively selected a pin,
    // otherwise every re-filter would yank the map out from under them.
    if (bounds.length && !selectedId) {
      map.fitBounds(L.latLngBounds(bounds).pad(0.18), { animate: false, maxZoom: 15 });
    }
  }, [results, selectedId]);

  /* ------------------------------------ fly to a selected result card */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const marker = markersRef.current.get(selectedId);
    if (!marker) return;

    const target = marker.getLatLng();
    // offsetY lifts the pin above the card that is about to scroll it into view.
    map.panTo(target, { animate: true, duration: 0.35 });
    marker.openPopup();
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className={className}
      role="application"
      aria-label="Map of animal rescue contacts near you"
    />
  );
}

function buildIcon(org, rank, active) {
  return L.divIcon({
    className: 'bg-transparent border-0',
    html: pinHtml({
      category: org.category,
      is24x7: org.is24x7,
      active,
      rank,
      source: org.source,
    }),
    iconSize: [30, 44],
    iconAnchor: [15, 44],
    popupAnchor: [0, -42],
  });
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function popupHtml(org) {
  const colour = categoryMeta(org.category);
  return `
    <div style="min-width:180px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${colour.pin}"></span>
        <span style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${colour.pin}">
          ${escapeHtml(colour.label)}
        </span>
        ${org.is24x7 ? '<span style="font-size:11px;font-weight:700;color:#c2410c">24x7</span>' : ''}
      </div>
      ${
        org.source === 'live'
          ? '<div style="display:inline-block;font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;border-radius:99px;padding:1px 6px;margin-bottom:4px">Not phone-verified</div>'
          : org.verified
            ? '<div style="display:inline-block;font-size:10px;font-weight:700;color:#166534;background:#dcfce7;border-radius:99px;padding:1px 6px;margin-bottom:4px">Verified</div>'
            : ''
      }
      <div style="font-weight:700;line-height:1.25;margin-bottom:4px">${escapeHtml(org.name)}</div>
      ${org.distanceKm != null ? `<div style="font-size:12px;color:#475569;margin-bottom:6px">${org.distanceKm} km away</div>` : ''}
      <a href="tel:${escapeHtml(String(org.phone).replace(/[^\d+]/g, ''))}"
         style="display:inline-block;background:#ea580c;color:#fff;font-weight:700;font-size:14px;
                padding:8px 14px;border-radius:10px;text-decoration:none">Call now</a>
    </div>
  `;
}
