/**
 * A stand-in for the public Overpass API, for tests only.
 *
 * The live vet lookup is the one part of the server that talks to the network.
 * Pointing it at the real overpass-api.de would make the suite slow, flaky and
 * dependent on a third party's uptime, so tests point OVERPASS_API_URL here
 * instead. Responses are canned OSM shapes, which is the actual contract.
 *
 * Exports:
 *   startMockOverpass(elements) -> { url, requests, setBehaviour, close }
 *     elements   - canned array returned for every query
 *     behaviour  - 'ok' | 'error' | 'hang' | 'garbage'
 */
import http from 'node:http';

export function startMockOverpass(elements = [], behaviour = 'ok') {
  const state = { requests: [], behaviour };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      // Overpass takes the query as form data, so it arrives URL-encoded.
      const query = new URLSearchParams(body).get('data') || '';
      state.requests.push({
        url: req.url,
        userAgent: req.headers['user-agent'],
        contentType: req.headers['content-type'],
        body,
        query,
      });

      if (state.behaviour === 'hang') return; // never responds: exercises the timeout
      if (state.behaviour === 'error') {
        res.writeHead(504, { 'content-type': 'text/plain' });
        return res.end('gateway timeout');
      }
      if (state.behaviour === 'garbage') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('<html>rate limited, please retry</html>');
      }

      // The real Overpass applies the query's tag filter server-side, so a
      // non-matching element never comes back. The mock does the same, or the
      // app's own filtering would look like it works when it does not.
      const wantsVet = /amenity"?\]?="veterinary"/.test(query) || /amenity=veterinary/.test(query);
      const matched = wantsVet
        ? elements.filter((el) => el.tags?.amenity === 'veterinary')
        : elements;

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: 0.6, generator: 'mock', elements: matched }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/api/interpreter`,
        get requests() {
          return state.requests;
        },
        setBehaviour(next) {
          state.behaviour = next;
        },
        reset() {
          state.requests.length = 0;
        },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/**
 * Canned Overpass elements near Coimbatore.
 *
 * Deliberately mixed: a node with a phone, a node with no phone at all, a way
 * (geometry in `center`, not lat/lon), a non-24/7 clinic, a 24/7 clinic, and a
 * non-veterinary node that must never be returned.
 */
export const COIMBATORE_VETS = [
  {
    type: 'node',
    id: 900001,
    lat: 11.0168,
    lon: 76.9558,
    tags: {
      amenity: 'veterinary',
      name: "Ravi's Pet Clinic",
      phone: '+91 98765 43210',
      'opening_hours': 'Mo-Sa 10:00-19:00',
      'addr:street': '100 Feet Road',
      'addr:city': 'Coimbatore',
    },
  },
  {
    type: 'node',
    id: 900002,
    lat: 11.0301,
    lon: 76.9712,
    tags: {
      amenity: 'veterinary',
      name: 'Twenty Four Seven Animal Hospital',
      'opening_hours': '24/7',
      'addr:city': 'Coimbatore',
    },
  },
  {
    type: 'way',
    id: 900003,
    center: { lat: 11.0055, lon: 76.9420 },
    tags: {
      amenity: 'veterinary',
      name: 'City Veterinary Hospital',
      'contact:phone': '+91 422 254 5555;+91 90000 00000',
      'addr:city': 'Coimbatore',
    },
  },
  {
    type: 'node',
    id: 900004,
    lat: 11.0500,
    lon: 77.0100,
    tags: {
      amenity: 'veterinary',
      name: 'Suburban Pet Care',
      'opening_hours': 'Mo-Su 09:00-13:00',
      'addr:city': 'Coimbatore',
    },
  },
  {
    type: 'node',
    id: 900005,
    lat: 11.0169,
    lon: 76.9559,
    tags: { amenity: 'pharmacy', name: 'Not A Vet' },
  },
];
