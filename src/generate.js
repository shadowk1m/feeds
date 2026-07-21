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

const PROXY_URL = process.env.CF_PROXY_URL;

function getProxiedUrl(targetUrl) {
  if (PROXY_URL && targetUrl.startsWith('https://linux.do')) {
    const base = PROXY_URL.endsWith('/') ? PROXY_URL.slice(0, -1) : PROXY_URL;
    return `${base}/?url=${encodeURIComponent(targetUrl)}`;
  }
  return targetUrl;
}

const BLACKLIST_KEYWORDS = (process.env.FEED_BLACKLIST || '')
  .split(',')
  .map(k => k.trim().toLowerCase())
  .filter(Boolean);

function isBlacklisted(item) {
  if (BLACKLIST_KEYWORDS.length === 0) return false;
  const haystack = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  return BLACKLIST_KEYWORDS.some(kw => haystack.includes(kw));
}

const FEEDS = [
  {
    id: 'v2ex-hot',
    filename: 'v2ex-hot.xml',
    title: 'V2EX Hot Topics',
    link: 'https://www.v2ex.com/?tab=hot',
    description: 'Hot topics from V2EX',
    fetcher: fetchV2ex
  },
  {
    id: 'linuxdo-news',
    filename: 'linuxdo-news.xml',
    title: 'LINUX DO - News',
    link: 'https://linux.do/c/news/34',
    description: 'News category from linux.do',
    fetcher: () => fetchDiscourseCategory({
      rssUrl: 'https://linux.do/c/news/34.rss',
      jsonUrl: 'https://linux.do/c/news/34.json',
      baseUrl: 'https://linux.do',
      idPrefix: 'linuxdo-news'
    })
  },
  {
    id: 'linuxdo-welfare',
    filename: 'linuxdo-welfare.xml',
    title: 'LINUX DO - Welfare',
    link: 'https://linux.do/c/welfare/36',
    description: 'Welfare category from linux.do',
    fetcher: () => fetchDiscourseCategory({
      rssUrl: 'https://linux.do/c/welfare/36.rss',
      jsonUrl: 'https://linux.do/c/welfare/36.json',
      baseUrl: 'https://linux.do',
      idPrefix: 'linuxdo-welfare'
    })
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

// Chrome-like UA — linux.do (Cloudflare) 403s obvious bot UAs from CI IP ranges.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchJson(url, options = {}) {
  const proxiedUrl = getProxiedUrl(url);
  const res = await fetch(proxiedUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    ...options
  });
  if (!res.ok) throw new Error(`Request failed ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url, options = {}) {
  const proxiedUrl = getProxiedUrl(url);
  const res = await fetch(proxiedUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    ...options
  });
  if (!res.ok) throw new Error(`Request failed ${res.status} ${url}`);
  return res.text();
}

function unwrapCdata(s = '') {
  const m = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m ? m[1] : s;
}

function decodeEntities(s = '') {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function pickTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decodeEntities(unwrapCdata(m[1].trim()));
}

async function fetchRss(url, idPrefix) {
  const xml = await fetchText(url);
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = pickTag(block, 'title') || 'Untitled';
    const link = pickTag(block, 'link');
    const guidRaw = pickTag(block, 'guid');
    const pubDate = pickTag(block, 'pubDate');
    const description = pickTag(block, 'description');
    items.push({
      title,
      link: link || url,
      guid: guidRaw || `${idPrefix}-${link || title}`,
      date: pubDate ? new Date(pubDate) : new Date(),
      description
    });
  }
  return items;
}

// Discourse category endpoint — falls back to the JSON API when the .rss URL
// is blocked (linux.do's Cloudflare rules 403 the RSS from CI ranges more
// aggressively than the JSON endpoint).
async function fetchDiscourseCategory({ rssUrl, jsonUrl, baseUrl, idPrefix }) {
  try {
    const items = await fetchRss(rssUrl, idPrefix);
    if (items.length > 0) return items;
    console.log(`  ${idPrefix}: rss returned 0 items, trying json`);
  } catch (e) {
    console.log(`  ${idPrefix}: rss failed (${e.message}), trying json`);
  }
  const data = await fetchJson(jsonUrl);
  const topics = data?.topic_list?.topics || [];
  return topics.map(t => {
    const slug = t.slug || 'topic';
    const link = `${baseUrl}/t/${slug}/${t.id}`;
    return {
      title: t.title || 'Untitled',
      link,
      guid: `${idPrefix}-${t.id}`,
      date: new Date(t.created_at || t.bumped_at || Date.now()),
      description: t.excerpt || t.title || ''
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
  const rawItems = await feedMeta.fetcher();
  const items = rawItems.filter(it => !isBlacklisted(it));
  const filtered = rawItems.length - items.length;
  if (filtered > 0) {
    console.log(`  filtered ${filtered} item(s) by blacklist`);
  }
  const xml = buildRss({
    title: feedMeta.title,
    link: feedMeta.link,
    description: feedMeta.description,
    items
  });
  const outPath = path.join(DOCS_DIR, feedMeta.filename);
  await writeFile(outPath, xml, 'utf8');
  return { ...feedMeta, count: items.length, filtered, outPath };
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
