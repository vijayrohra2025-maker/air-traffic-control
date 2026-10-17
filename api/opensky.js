let cachedToken = '';
let tokenExpiresAt = 0;

async function getAccessToken(signal) {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return '';
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const tokenResponse = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal,
  });
  if (!tokenResponse.ok) throw new Error(`OpenSky authentication failed (${tokenResponse.status})`);

  const tokenData = await tokenResponse.json();
  cachedToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + Math.max(0, tokenData.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const upstreamUrl = new URL('https://opensky-network.org/api/states/all');
  for (const parameter of ['lamin', 'lomin', 'lamax', 'lomax']) {
    const value = request.query[parameter];
    if (typeof value === 'string') upstreamUrl.searchParams.set(parameter, value);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);

  try {
    let accessToken = '';
    try {
      accessToken = await getAccessToken(controller.signal);
    } catch (error) {
      if (error.message.match(/^OpenSky authentication failed \(\d{3}\)$/) || controller.signal.aborted) {
        throw error;
      }
      console.error('OpenSky authentication server unavailable; retrying anonymously:', error.name, error.message);
    }
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      signal: controller.signal,
    });
    const body = await upstreamResponse.text();
    response.setHeader('Cache-Control', upstreamResponse.ok ? 's-maxage=10, stale-while-revalidate=30' : 'no-store');
    response.setHeader('Content-Type', upstreamResponse.headers.get('content-type') ?? 'application/json');
    return response.status(upstreamResponse.status).send(body);
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    const authenticationFailure = error.message.match(/^OpenSky authentication failed \((\d{3})\)$/);
    const errorMessage = timedOut
      ? 'OpenSky request timed out. Try again later.'
      : authenticationFailure
      ? `OpenSky authentication failed (${authenticationFailure[1]}). Check the Vercel client ID and secret.`
      : 'Vercel could not connect to OpenSky. Check the function logs.';
    console.error('OpenSky proxy request failed:', error.name, error.message, error.cause?.message ?? '');
    return response.status(timedOut ? 504 : 502).json({
      error: errorMessage,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
