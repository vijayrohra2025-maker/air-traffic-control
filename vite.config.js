import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import handler from './api/opensky.js';

// Serves /api/opensky from the Vite dev/preview server, so `npm run dev`
// works without the Vercel CLI. Uses the same handler as the Vercel function.
function openskyProxy(env) {
  const middleware = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/opensky') return next();

    if (env.OPENSKY_CLIENT_ID && !process.env.OPENSKY_CLIENT_ID) {
      process.env.OPENSKY_CLIENT_ID = env.OPENSKY_CLIENT_ID;
    }
    if (env.OPENSKY_CLIENT_SECRET && !process.env.OPENSKY_CLIENT_SECRET) {
      process.env.OPENSKY_CLIENT_SECRET = env.OPENSKY_CLIENT_SECRET;
    }

    const response = {
      setHeader: (name, value) => res.setHeader(name, value),
      status(code) { res.statusCode = code; return response; },
      json(body) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      },
      send(body) { res.end(body); },
    };
    await handler({ method: req.method, query: Object.fromEntries(url.searchParams) }, response);
  };

  return {
    name: 'opensky-proxy',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'OPENSKY_');
  return { plugins: [react(), openskyProxy(env)] };
});
