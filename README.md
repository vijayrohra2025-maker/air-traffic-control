# Airspace Flight Intelligence

Airspace is a web dashboard that displays aircraft position reports for **Western Europe**. It combines live aircraft state data from the OpenSky Network with an interactive map from OpenStreetMap. It is a learning project—not an air traffic control system—and it does not create fake aircraft when live data is unavailable.

## What you can do

- View aircraft positions on a Leaflet map and select an aircraft to see its reported details.
- Search and filter the aircraft list by callsign, status, or minimum altitude.
- See aircraft that are airborne, on the ground, stale, or recently outside the monitored area.
- Set an altitude alert threshold and select aircraft meeting that threshold.
- Review recent data requests and see when the last successful update occurred.

The monitored area is fixed to Western Europe in `src/data/regions.js`. The dashboard normally polls about every 15 minutes; you can also request a manual refresh.

## Advantages

- Combines a map, aircraft list, and selected-aircraft details in one dashboard.
- Makes it easier to inspect reports with search, status and altitude filters, pagination, and configurable altitude alerts.
- Keeps the last successful snapshot visible during temporary API failures and explains when fresh data cannot be loaded.
- Keeps the OpenSky API request server-side to avoid browser CORS restrictions and protect API credentials.

## Run it on your computer

You need **Node.js 18 or newer**, npm, and an internet connection for OpenSky data and map tiles. To run the serverless API locally, use the Vercel CLI with `vercel dev`.

1. Open a terminal in the project folder.
2. Install the dependencies:

   ```sh
   npm install
   ```

3. Start the development server:

   ```sh
   npx vercel dev
   ```

4. Open the local address printed in the terminal.

To stop the server, press `Ctrl+C` in the terminal.

## How the data gets to the screen

1. The browser asks the same-origin `/api/opensky` function for aircraft in the Western Europe bounds.
2. The serverless function requests OpenSky state vectors and forwards the response to the existing dashboard data converter. When `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` are configured, it obtains and caches an OAuth token.
3. Vercel caches the response briefly so visitors do not each trigger a new set of upstream requests.
4. `src/data/aircraft.js` converts the returned positional arrays into named aircraft fields and converts altitude and speed into feet and knots.
5. `src/App.jsx` keeps the aircraft snapshot and interface state, including selected aircraft, filters, alerts, loading status, and errors.
6. React renders the resulting data in the map, statistics, and aircraft table. The Leaflet map uses OpenStreetMap tiles for its background.

There is **no database**. The browser stores a small versioned snapshot in `localStorage`, so it can show the last successful data while it tries to refresh. That saved data is local to the browser and is not a shared history service.

## Data freshness, errors, and request limits

- A report with no contact for more than two minutes is marked **stale**. A small clock updates its visible age between API polls.
- Requests time out after 25 seconds. Failed requests are retried with increasing delays, up to five minutes. The dashboard keeps the last successful results and displays an error instead of treating a failed request as an empty region.
- Polling is intentionally limited to about once every 15 minutes. OpenSky applies account-based rate limits; keep refreshes reasonable and review its current API documentation and usage limits.
- Each aircraft keeps up to 12 distinct reported positions in local storage. A dashed track is shown only when there are at least two positions. This is not a complete flight-history archive, and the app does not predict future positions.
- OpenSky coverage is incomplete and varies by location. A blank part of the map does **not** prove no aircraft are there. Callsigns or other fields may also be missing.

## Limitations

- The dashboard only monitors the configured Western Europe region; it does not show global traffic or guarantee that every aircraft in that region will appear.
- The data is limited by OpenSky's sensor coverage, account rate limits, and service availability. A 15-minute polling interval is suitable for this dashboard, but it is not continuous radar tracking.
- Aircraft missing from a later response are retained in the table as recently departed for up to one hour. Cached reports and saved movement history exist only in the current browser.
- The app does not provide a complete flight-history archive, predict future positions, or support real operational air traffic control.

## Main project files

- `src/main.jsx` loads Leaflet and the dashboard stylesheet, then starts the React app.
- `src/App.jsx` renders the dashboard and manages its interface and request state.
- `src/data/regions.js` defines the monitored bounds and polling interval.
- `src/data/aircraft.js` converts, merges, and tracks aircraft reports.
- `src/data/cache.js` saves and reads the browser's last successful snapshot.
- `src/data/*.test.js` contains automated tests for aircraft conversion, merging, retry behavior, and caching.
- `src/dashboard.css` contains all app-specific styles and responsive layout rules.
- `api/opensky.js` authenticates when credentials are configured and proxies the dashboard request on Vercel.

## Check and build the project

Run the automated tests:

```sh
npm test
```

Create and locally preview the production build:

```sh
npm run build
npm run preview
```

Vite writes the production files to `dist/`. Unit tests check the app's data-handling logic, but they do not guarantee that OpenSky is reachable at a particular time.

## Deploy on Vercel

1. Push this project to a GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Use `npm run build` for the build command and `dist` for the output directory if Vercel does not detect them automatically.
4. Add `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` as Vercel environment variables for the deployment environments you use, then deploy. Vercel serves the app and runs the `/api/opensky` serverless function.

For another static host, configure an equivalent serverless function and single-page-app fallback.

This dashboard is for learning and demonstration only; do not use it for operational or safety-critical decisions.
