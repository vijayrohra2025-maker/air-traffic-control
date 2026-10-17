// Temporary diagnostic. Visit /api/opensky-test on your deployed site.
// It checks what the Vercel server can reach and how long each request takes.

async function probe(name, url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    return { name, ok: res.ok, status: res.status, ms: Date.now() - started, preview: text.slice(0, 120) };
  } catch (error) {
    return {
      name,
      ok: false,
      ms: Date.now() - started,
      error: `${error.name}: ${error.message}`,
      cause: `${error.cause?.code ?? ''} ${error.cause?.message ?? ''}`.trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(request, response) {
  const hasCredentials = Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);

  const tokenOptions = hasCredentials
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.OPENSKY_CLIENT_ID,
          client_secret: process.env.OPENSKY_CLIENT_SECRET,
        }),
      }
    : null;

  const tests = await Promise.all([
    probe('1_neutral_site', 'https://example.com'),
    probe('2_opensky_data_anonymous', 'https://opensky-network.org/api/states/all?lamin=50&lomin=5&lamax=51&lomax=6'),
    hasCredentials
      ? probe('3_opensky_login_server', 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', tokenOptions)
      : Promise.resolve({ name: '3_opensky_login_server', skipped: 'OPENSKY_CLIENT_ID / SECRET not set on Vercel' }),
  ]);

  // Never print secrets or tokens.
  for (const test of tests) {
    if (test.name === '3_opensky_login_server' && test.preview) test.preview = '(hidden)';
  }

  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({
    region: process.env.VERCEL_REGION ?? 'unknown',
    hasCredentials,
    tests,
  });
}