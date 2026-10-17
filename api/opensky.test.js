import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './opensky.js';

test('opensky handler rejects non-GET requests', async () => {
  let statusCode = 0;
  let headers = {};
  let responseBody = null;

  const req = { method: 'POST', query: {} };
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status(code) { statusCode = code; return res; },
    json(body) { responseBody = body; },
    send(body) { responseBody = body; },
  };

  await handler(req, res);
  assert.equal(statusCode, 405);
  assert.equal(headers['Allow'], 'GET');
  assert.deepEqual(responseBody, { error: 'Method not allowed' });
});

test('opensky handler ignores string "undefined" in env vars', async () => {
  const previousId = process.env.OPENSKY_CLIENT_ID;
  const previousSecret = process.env.OPENSKY_CLIENT_SECRET;

  try {
    process.env.OPENSKY_CLIENT_ID = 'undefined';
    process.env.OPENSKY_CLIENT_SECRET = 'undefined';

    let statusCode = 0;
    const req = { method: 'GET', query: { lamin: '45', lomin: '-5', lamax: '58', lomax: '15' } };
    const res = {
      setHeader() {},
      status(code) { statusCode = code; return res; },
      send() {},
      json() {},
    };

    await handler(req, res);
    assert.notEqual(statusCode, 502);
  } finally {
    if (previousId === undefined) delete process.env.OPENSKY_CLIENT_ID;
    else process.env.OPENSKY_CLIENT_ID = previousId;

    if (previousSecret === undefined) delete process.env.OPENSKY_CLIENT_SECRET;
    else process.env.OPENSKY_CLIENT_SECRET = previousSecret;
  }
});
