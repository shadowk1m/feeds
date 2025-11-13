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

## Extending

Add another feed: push a new object into the `FEEDS` array in `src/generate.js` with an `id`, metadata, and a `fetcher` function returning normalized items: `{ title, link, guid, date, description }`.

## Notes & Caveats

- Zhihu API response structure can change; fallback logic attempts to extract a title, link, and timestamp. Adjust if fields drift.
- If either API rate-limits or blocks requests, consider adding retry/backoff or a proxy later.
- Keep cron at 15 minutes to respect upstream load; avoid more aggressive schedules without need.

## License

MIT
