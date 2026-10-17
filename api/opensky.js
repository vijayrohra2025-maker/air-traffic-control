// Vercel function. OpenSky does not answer Vercel's servers, so this asks a relay
// that runs on a computer OpenSky does answer (see relay/relay.mjs). The relay's
// public (tunnel) address is stored in the Vercel variable OPENSKY_RELAY_URL.

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const relayBase = process.env.OPENSKY_RELAY_URL;
  if (!relayBase) {
    return response.status(500).json({ error: 'OPENSKY_RELAY_URL is not set in the Vercel project settings.' });
  }

  let relayUrl;
  try {
    relayUrl = new URL(relayBase);
  } catch {
    return response.status(500).json({ error: 'OPENSKY_RELAY_URL is not a valid web address.' });
  }
  for (const parameter of ['lamin', 'lomin', 'lamax', 'lomax']) {
    const value = request.query[parameter];
    if (typeof value === 'string') relayUrl.searchParams.set(parameter, value);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 13_000); // under the browser's 15 s limit

  try {
    const relayResponse = await fetch(relayUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await relayResponse.text();
    response.setHeader('Cache-Control', relayResponse.ok ? 's-maxage=10, stale-while-revalidate=30' : 'no-store');
    response.setHeader('Content-Type', relayResponse.headers.get('content-type') ?? 'application/json');
    return response.status(relayResponse.status).send(body);
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    console.error('Relay request failed:', error.name, error.message, error.cause?.message ?? '');
    return response.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? 'The OpenSky relay did not answer in time. Is the relay and tunnel running on the host computer?'
        : 'Could not reach the OpenSky relay. Is the relay and tunnel running on the host computer?',
      detail: `${error.name}: ${error.message}`,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}