#!/usr/bin/env node
/**
 * Feed Generator
 * Fetches Zhihu hot list and V2EX hot topics and outputs RSS XML files
 * into docs/ (for GitHub Pages). Also creates/updates an index.html page.
 *
 * Uses native fetch (Node 18+). No external dependencies.
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DOCS_DIR = path.resolve('docs');
const FEEDS = [
  // {
  //   id: 'zhihu-hot',
  //   filename: 'zhihu-hot.xml',
  //   title: 'Zhihu Hot List',
  //   link: 'https://www.zhihu.com/hot',
  //   description: 'Top hot list items from Zhihu',
  //   fetcher: fetchZhihu
  // },
  {
    id: 'v2ex-hot',
    filename: 'v2ex-hot.xml',
    title: 'V2EX Hot Topics',
    link: 'https://www.v2ex.com/?tab=hot',
    description: 'Hot topics from V2EX',
    fetcher: fetchV2ex
  }
];

async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

function rfc822(date = new Date()) {
  return date.toUTCString();
}

function escapeXml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRss({ title, link, description, items }) {
  const lastBuildDate = rfc822();
  const itemXml = items.map(it => `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${escapeXml(it.link)}</link>
      <guid>${escapeXml(it.guid || it.link)}</guid>
      <pubDate>${rfc822(it.date)}</pubDate>
      <description>${escapeXml(it.description || it.title)}</description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escapeXml(title)}</title>\n    <link>${escapeXml(link)}</link>\n    <description>${escapeXml(description)}</description>\n    <lastBuildDate>${lastBuildDate}</lastBuildDate>\n${itemXml}\n  </channel>\n</rss>\n`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (FeedGenerator)',
      'Accept': 'application/json',
    },
    ...options
  });
  if (!res.ok) throw new Error(`Request failed ${res.status} ${url}`);
  return res.json();
}

async function fetchZhihu() {
  const url = 'https://api.zhihu.com/topstory';
  const data = await fetchJson(url);
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.map(item => {
    // Attempt to normalize differing shapes
    const t = item.target || item.question || item;
    const title = t?.title || t?.question?.title || t?.excerpt || 'Untitled';
    let link = t?.url || t?.link;
    if (link && link.startsWith('http')) {
      // ok
    } else if (t?.id) {
      link = `https://www.zhihu.com/question/${t.id}`;
    } else {
      link = 'https://www.zhihu.com/hot';
    }
    const created = (t?.created || t?.created_time || Date.now()/1000) * 1000;
    return {
      title,
      link,
      guid: item.id ? `zhihu-${item.id}` : link,
      date: new Date(created),
      description: t?.content || t?.excerpt || t?.description || ''
    };
  });
}

async function fetchV2ex() {
  const url = 'https://www.v2ex.com/api/topics/hot.json';
  const data = await fetchJson(url);
  const list = Array.isArray(data) ? data : [];
  return list.map(item => {
    const link = item.url || `https://www.v2ex.com/t/${item.id}`;
    return {
      title: item.title || 'Untitled',
      link,
      guid: `v2ex-${item.id}`,
      date: new Date(item.created ? item.created * 1000 : Date.now()),
      description: item.content_rendered || item.content || ''
    };
  });
}

async function writeFeed(feedMeta) {
  const items = await feedMeta.fetcher();
  const xml = buildRss({
    title: feedMeta.title,
    link: feedMeta.link,
    description: feedMeta.description,
    items
  });
  const outPath = path.join(DOCS_DIR, feedMeta.filename);
  await writeFile(outPath, xml, 'utf8');
  return { ...feedMeta, count: items.length, outPath };
}

async function buildIndex(results) {
  const now = new Date();
  const rows = await Promise.all(results.map(async r => {
    let fileSize = 0;
    try {
      const s = await stat(r.outPath);
      fileSize = s.size;
    } catch {}
    return `<tr><td><a href="${r.filename}">${r.title}</a></td><td>${r.count}</td><td>${fileSize}</td><td>${now.toISOString()}</td></tr>`;
  }));
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Feeds Index</title><style>body{font-family:system-ui,Arial,sans-serif;padding:1rem;}table{border-collapse:collapse;width:100%;max-width:800px;}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;}caption{font-weight:600;margin-bottom:.5rem;}code{background:#f5f5f5;padding:2px 4px;border-radius:3px;font-size:.85em;}footer{margin-top:1rem;font-size:.8em;color:#666;}</style></head><body><h1>Generated RSS Feeds</h1><p>Updated at <code>${now.toISOString()}</code></p><table><caption>Available Feeds</caption><thead><tr><th>Feed</th><th>Items</th><th>Size (bytes)</th><th>Generated</th></tr></thead><tbody>${rows.join('')}</tbody></table><footer>Automated generation every 15 minutes via GitHub Actions.</footer></body></html>`;
  await writeFile(path.join(DOCS_DIR, 'index.html'), html, 'utf8');
}

async function main() {
  await ensureDir(DOCS_DIR);
  const results = [];
  for (const feed of FEEDS) {
    try {
      console.log(`Generating ${feed.id}...`);
      const res = await writeFeed(feed);
      results.push(res);
      console.log(`✅ ${feed.filename} (${res.count} items)`);
    } catch (e) {
      console.error(`❌ Failed ${feed.id}:`, e.message);
    }
  }
  await buildIndex(results);
  console.log('Index generated.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}
