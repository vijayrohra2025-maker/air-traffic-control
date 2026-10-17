// Vercel serverless function proxying live flight data.
// Attempts OpenSky Network first with OAuth credentials. If OpenSky blocks cloud
// datacenter connections (UND_ERR_CONNECT_TIMEOUT / 502 / 429), it automatically
// provides live flight telemetry from the open ADS-B network so the dashboard
// remains 100% operational in the cloud with zero external dependencies.

const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
const OPENSKY_AUTH_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let cachedToken = '';
let tokenExpiresAt = 0;

async function getAccessToken(signal) {
  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || clientId === 'undefined' || clientSecret === 'undefined') return '';
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const tokenResponse = await fetch(OPENSKY_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'AirspaceFlightIntelligence/1.0',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal,
  });

  if (!tokenResponse.ok) {
    throw new Error(`OpenSky authentication failed (${tokenResponse.status})`);
  }

  const tokenData = await tokenResponse.json();
  cachedToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + Math.max(0, (tokenData.expires_in || 1800) - 60) * 1000;
  return cachedToken;
}

// Open community ADS-B network that allows cloud data centers (Vercel/AWS) without blocks
async function fetchLiveAdsbNetwork(bounds, signal) {
  const centerLat = ((bounds.lamin + bounds.lamax) / 2) || 51.4;
  const centerLon = ((bounds.lomin + bounds.lomax) / 2) || 5.0;
  const searchRadiusNauticalMiles = 250;

  const url = `https://api.adsb.lol/v2/point/${centerLat}/${centerLon}/${searchRadiusNauticalMiles}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'AirspaceFlightIntelligence/1.0 (https://github.com/vijayrohra2025-maker/air-traffic-control)',
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`ADS-B feed returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const nowSeconds = Math.round(Date.now() / 1000);

  const states = (data.ac || [])
    .filter((plane) => (
      typeof plane.lat === 'number' &&
      typeof plane.lon === 'number' &&
      plane.lat >= bounds.lamin &&
      plane.lat <= bounds.lamax &&
      plane.lon >= bounds.lomin &&
      plane.lon <= bounds.lomax
    ))
    .map((plane) => {
      const altitudeFeet = typeof plane.alt_baro === 'number'
        ? plane.alt_baro
        : (typeof plane.alt_geom === 'number' ? plane.alt_geom : null);
      const altitudeMeters = altitudeFeet !== null ? altitudeFeet * 0.3048 : null;
      const speedKnots = typeof plane.gs === 'number' ? plane.gs : null;
      const speedMps = speedKnots !== null ? speedKnots / 1.94384 : null;
      const heading = plane.track ?? plane.true_heading ?? null;
      const onGround = plane.alt_baro === 'ground';

      return [
        plane.hex,
        typeof plane.flight === 'string' ? plane.flight.trim() : (plane.hex ? plane.hex.toUpperCase() : ''),
        '',
        nowSeconds,
        nowSeconds,
        plane.lon,
        plane.lat,
        onGround ? 0 : altitudeMeters,
        onGround,
        speedMps,
        heading,
      ];
    });

  return {
    time: nowSeconds,
    states,
  };
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const bounds = {
    lamin: parseFloat(request.query.lamin || '45'),
    lomin: parseFloat(request.query.lomin || '-5'),
    lamax: parseFloat(request.query.lamax || '58'),
    lomax: parseFloat(request.query.lomax || '15'),
  };

  const upstreamUrl = new URL(OPENSKY_API_URL);
  for (const parameter of ['lamin', 'lomin', 'lamax', 'lomax']) {
    const value = request.query[parameter];
    if (typeof value === 'string') upstreamUrl.searchParams.set(parameter, value);
  }

  // Use an 8s timeout for OpenSky so visitors don't wait 25s when Vercel is blocked
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    let accessToken = '';
    try {
      accessToken = await getAccessToken(controller.signal);
    } catch (authError) {
      if (authError.message.match(/^OpenSky authentication failed \(\d{3}\)$/)) {
        throw authError;
      }
      console.warn('OpenSky auth server unreachable, attempting anonymous fetch:', authError.message);
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AirspaceFlightIntelligence/1.0',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      signal: controller.signal,
    });

    if (upstreamResponse.ok) {
      const body = await upstreamResponse.text();
      response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
      response.setHeader('Content-Type', upstreamResponse.headers.get('content-type') ?? 'application/json');
      return response.status(200).send(body);
    }

    // If OpenSky returns 429 rate limit or error, fall through to community ADS-B
    console.log(`OpenSky returned HTTP ${upstreamResponse.status}. Using live ADS-B network.`);
    const liveData = await fetchLiveAdsbNetwork(bounds, controller.signal);
    response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Data-Source', 'live-adsb');
    return response.status(200).json(liveData);
  } catch (error) {
    // If OpenSky times out (e.g. UND_ERR_CONNECT_TIMEOUT from Vercel) or fails:
    try {
      console.log('OpenSky connection blocked/timed out. Switching to live ADS-B network.');
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 8_000);
      const liveData = await fetchLiveAdsbNetwork(bounds, fallbackController.signal);
      clearTimeout(fallbackTimeout);

      response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('X-Data-Source', 'live-adsb');
      return response.status(200).json(liveData);
    } catch (fallbackError) {
      const timedOut = error.name === 'AbortError';
      const authFailure = error.message.match(/^OpenSky authentication failed \((\d{3})\)$/);
      const errorMessage = timedOut
        ? 'Flight data request timed out. Please try again.'
        : authFailure
        ? `OpenSky authentication failed (${authFailure[1]}). Check OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET.`
        : `Unable to connect to flight data services (${error.cause?.code ?? error.message}).`;

      return response.status(timedOut ? 504 : 502).json({
        error: errorMessage,
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
