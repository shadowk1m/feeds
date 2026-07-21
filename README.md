# Feeds Generator

Generates RSS feeds for:

1. Zhihu Hot List (`zhihu-hot.xml`)
2. V2EX Hot Topics (`v2ex-hot.xml`)

Published via GitHub Pages from the `docs/` directory (an index page links to the feeds).

## How It Works

The script `src/generate.js` (Node.js 18+) fetches JSON from each source API, normalizes the data, and writes RSS 2.0 XML files into `docs/`. It also regenerates `docs/index.html` with a table of feeds, item counts, and the generation timestamp.

No external dependencies are required (uses the built–in `fetch`).

## Run Locally

```bash
node -v # ensure >= 18
npm run generate
```

Output files:

```
docs/zhihu-hot.xml
docs/v2ex-hot.xml
docs/index.html
```

Open `docs/index.html` in a browser or serve via a static server.

## GitHub Actions Automation

Workflow: `.github/workflows/update-feeds.yml`

Runs every 15 minutes (`*/15 * * * *`) and on manual dispatch. It:

1. Checks out the repo
2. Runs the generator
3. Commits updated XML & index if contents changed

## GitHub Pages Setup

Configure the repository settings:

- Pages Source: Deploy from branch = `main` (or default), folder = `/docs`
- Ensure `.nojekyll` exists at `docs/.nojekyll` (already added) so XML serves raw.

Then your feeds will be available at URLs like:

```
https://<your-username>.github.io/<repo-name>/zhihu-hot.xml
https://<your-username>.github.io/<repo-name>/v2ex-hot.xml
```

## Keyword Blacklist

Set the `FEED_BLACKLIST` environment variable to a comma-separated list of keywords. Items whose title or description contains any keyword (case-insensitive substring match) are dropped before the RSS file is written.

```bash
FEED_BLACKLIST="广告,推广,sponsored" npm run generate
```

Leave the variable unset (or empty) to disable filtering. To use this in GitHub Actions, add `FEED_BLACKLIST` as a repository variable (Settings → Secrets and variables → Actions → Variables) — the workflow already wires it through to the generator step.

## Cloudflare Proxy (for linux.do)

Since `linux.do` uses Cloudflare's WAF and blocks GitHub Actions IP ranges with a `403` error, requests to `linux.do` can be routed through a Cloudflare Worker proxy.

To set this up:

1. Create a free Cloudflare Worker with the following code:
   ```javascript
   export default {
     async fetch(request, env, ctx) {
       const url = new URL(request.url);
       const targetUrl = url.searchParams.get('url');

       if (!targetUrl) {
         return new Response('Missing "url" query parameter.', { status: 400 });
       }

       // Restrict proxying only to linux.do to prevent open-proxy abuse
       if (!targetUrl.startsWith('https://linux.do/')) {
         return new Response('Forbidden target URL.', { status: 403 });
       }

       const modifiedHeaders = new Headers(request.headers);
       modifiedHeaders.set(
         'User-Agent',
         'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
       );

       try {
         const response = await fetch(targetUrl, {
           method: request.method,
           headers: modifiedHeaders,
           redirect: 'follow',
         });

         return new Response(response.body, {
           status: response.status,
           statusText: response.statusText,
           headers: response.headers,
         });
       } catch (err) {
         return new Response(`Proxy error: ${err.message}`, { status: 500 });
       }
     }
   };
   ```

2. Add your Worker's URL (e.g., `https://your-proxy.workers.dev`) to your GitHub repository:
   - Go to **Settings** → **Secrets and variables** → **Actions**.
   - You can add it as a **Secret** named `CF_PROXY_URL` or as a **Variable** named `CF_PROXY_URL`. The workflow will automatically pick it up from either.

Once configured, the generator will automatically route all requests targeting `linux.do` through your Cloudflare Worker proxy to safely bypass the Cloudflare blocks.

## Extending

Add another feed: push a new object into the `FEEDS` array in `src/generate.js` with an `id`, metadata, and a `fetcher` function returning normalized items: `{ title, link, guid, date, description }`.

## Notes & Caveats

- Zhihu API response structure can change; fallback logic attempts to extract a title, link, and timestamp. Adjust if fields drift.
- If either API rate-limits or blocks requests, consider adding retry/backoff or a proxy later.
- Keep cron at 15 minutes to respect upstream load; avoid more aggressive schedules without need.

## License

MIT
