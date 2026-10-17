const SEARCH_RADIUS_NAUTICAL_MILES = 250;
const POSITION_GRID = [
  [47.2, -1.7], [47.2, 5], [47.2, 11.7],
  [51.5, -1.7], [51.5, 5], [51.5, 11.7],
  [55.8, -1.7], [55.8, 5], [55.8, 11.7],
];

export function convertAircraft(aircraft, bounds, nowSeconds) {
  const latestAircraft = new Map();

  for (const plane of aircraft) {
    if (!plane || typeof plane.hex !== 'string'
      || !Number.isFinite(plane.lat) || !Number.isFinite(plane.lon)
      || plane.lat < bounds.lamin || plane.lat > bounds.lamax
      || plane.lon < bounds.lomin || plane.lon > bounds.lomax) continue;

    const existing = latestAircraft.get(plane.hex);
    if (!existing || (plane.seen_pos ?? Infinity) < (existing.seen_pos ?? Infinity)) {
      latestAircraft.set(plane.hex, plane);
    }
  }

  return Array.from(latestAircraft.values(), (plane) => {
    const altitudeFeet = Number.isFinite(plane.alt_baro)
      ? plane.alt_baro
      : Number.isFinite(plane.alt_geom) ? plane.alt_geom : null;
    const onGround = plane.alt_baro === 'ground'
      ? true
      : altitudeFeet !== null ? false : null;
    const seenPosition = Number.isFinite(plane.seen_pos) ? plane.seen_pos : null;
    const seen = Number.isFinite(plane.seen) ? plane.seen : null;

    return [
      plane.hex,
      typeof plane.flight === 'string' ? plane.flight : '',
      '',
      seenPosition === null ? null : Math.round(nowSeconds - seenPosition),
      seen === null ? null : Math.round(nowSeconds - seen),
      plane.lon,
      plane.lat,
      altitudeFeet === null ? null : altitudeFeet * 0.3048,
      onGround,
      Number.isFinite(plane.gs) ? plane.gs / 1.94384 : null,
      Number.isFinite(plane.track) ? plane.track : Number.isFinite(plane.true_heading) ? plane.true_heading : null,
    ];
  });
}

export async function fetchAircraft(bounds, signal, fetcher = fetch) {
  const responses = [];
  const failures = [];

  for (let index = 0; index < POSITION_GRID.length; index += 3) {
    const batch = POSITION_GRID.slice(index, index + 3);
    const results = await Promise.allSettled(batch.map(async ([latitude, longitude]) => {
      const url = `https://api.adsb.lol/v2/point/${latitude}/${longitude}/${SEARCH_RADIUS_NAUTICAL_MILES}`;
      const response = await fetcher(url, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`ADSB.lol returned ${response.status}`);
      return response.json();
    }));

    for (const result of results) {
      if (result.status === 'fulfilled') responses.push(result.value);
      else failures.push(result.reason);
    }
  }

  if (responses.length === 0) throw failures[0] ?? new Error('ADSB.lol returned no data');

  const timeMilliseconds = responses.find((result) => Number.isFinite(result.now))?.now;
  const nowSeconds = Number.isFinite(timeMilliseconds)
    ? Math.round(timeMilliseconds / 1000)
    : Math.round(Date.now() / 1000);
  const aircraft = responses.flatMap((result) => result.ac ?? result.aircraft ?? []);

  return {
    time: nowSeconds,
    states: convertAircraft(aircraft, bounds, nowSeconds),
    partial: failures.length > 0,
  };
}
