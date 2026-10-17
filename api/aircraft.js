import { fetchAircraft } from '../server/adsblol.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const bounds = {};
  for (const parameter of ['lamin', 'lomin', 'lamax', 'lomax']) {
    const value = Number(request.query[parameter]);
    if (!Number.isFinite(value)) {
      return response.status(400).json({ error: 'Invalid region bounds' });
    }
    bounds[parameter] = value;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);

  try {
    const result = await fetchAircraft(bounds, controller.signal);
    response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    response.setHeader('Content-Type', 'application/json');
    return response.status(200).json(result);
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    console.error('ADSB.lol proxy request failed:', error.name, error.message, error.cause?.message ?? '');
    return response.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'Aircraft data request timed out. Try again later.' : 'Could not reach ADSB.lol. Try again later.',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
