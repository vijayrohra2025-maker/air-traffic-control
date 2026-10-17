import test from 'node:test';
import assert from 'node:assert/strict';
import { convertAircraft, fetchAircraft } from './adsblol.js';

const bounds = { lamin: 45, lomin: -5, lamax: 58, lomax: 15 };

test('normalizes ADSB.lol reports, filters bounds, and keeps the freshest duplicate', () => {
  const states = convertAircraft([
    { hex: 'abc123', flight: 'ABC123 ', lat: 51, lon: 5, alt_baro: 30000, gs: 200, track: 180, seen: 1, seen_pos: 5 },
    { hex: 'abc123', flight: 'ABC123 ', lat: 51.1, lon: 5.1, alt_baro: 31000, gs: 210, track: 190, seen: 0.5, seen_pos: 1 },
    { hex: 'outside', lat: 60, lon: 5, alt_baro: 10000 },
    { hex: 'ground1', lat: 50, lon: 4, alt_baro: 'ground', seen: 2, seen_pos: 3 },
  ], bounds, 1_700_000_000);

  assert.equal(states.length, 2);
  assert.equal(states[0][0], 'abc123');
  assert.equal(states[0][5], 5.1);
  assert.ok(Math.abs(states[0][7] - 31000 * 0.3048) < 0.001);
  assert.ok(Math.abs(states[0][9] - 210 / 1.94384) < 0.001);
  assert.equal(states[1][8], true);
  assert.equal(states[1][7], null);
});

test('fetches nine map tiles and returns a normalized OpenSky-compatible response', async () => {
  const requestedUrls = [];
  const result = await fetchAircraft(bounds, new AbortController().signal, async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      json: async () => ({
        now: 1_700_000_000_000,
        ac: [{ hex: 'abc123', lat: 51, lon: 5, alt_baro: 10000, gs: 200, seen: 1, seen_pos: 2 }],
      }),
    };
  });

  assert.equal(requestedUrls.length, 9);
  assert.equal(result.time, 1_700_000_000);
  assert.equal(result.states.length, 1);
  assert.equal(result.states[0][0], 'abc123');
  assert.equal(result.partial, false);
});
