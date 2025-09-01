import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Utility functions from wayback-last.mjs
async function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

async function fetchRetry(url, opts = {}, retries = 3, backoffMs = 400) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    "user-agent": "wayback-cdx-extractor/1.0 (+https://example.local)",
                    ...(opts.headers || {}),
                },
                ...opts,
            });
            if (!res.ok) {
                if ((res.status === 429 || res.status >= 500) && i < retries) {
                    await sleep(backoffMs * Math.pow(2, i));
                    continue;
                }
                const text = await res.text().catch(() => "");
                throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 200)}`);
            }
            return res;
        } catch (err) {
            lastErr = err;
            if (i < retries) {
                await sleep(backoffMs * Math.pow(2, i));
                continue;
            }
        }
    }
    throw lastErr;
}

async function getCdxRows(domain, n = 5, unique = false) {
    const base = new URL("https://web.archive.org/cdx/search/cdx");
    base.searchParams.set("url", domain);
    base.searchParams.set("output", "json");
    base.searchParams.append("filter", "mimetype:text/html");
    base.searchParams.append("filter", "statuscode:200");
    base.searchParams.set("fl", "timestamp,original,mimetype,statuscode,digest,length");
    base.searchParams.set("fastLatest", "true");
    base.searchParams.set("limit", `-${n}`);
    if (unique) base.searchParams.set("collapse", "digest");

    const res = await fetchRetry(base.toString());
    const json = await res.json();
    const rows = json.slice(1);
    return rows.map((r) => ({
        timestamp: r[0],
        original: r[1],
        mimetype: r[2],
        statuscode: r[3],
        digest: r[4],
        length: Number(r[5] ?? 0),
    }));
}

function makeIdUrl(timestamp, original) {
    return `https://web.archive.org/web/${timestamp}id_/${original}`;
}

async function extractFromSnapshot(snapUrl) {
    const htmlRes = await fetchRetry(snapUrl);
    const html = await htmlRes.text();
    const $ = cheerio.load(html);

    const pick = (sel, attr = "content") => $(sel).attr(attr) || "";
    const title = $("title").first().text().trim();
    const description = pick('meta[name="description"]');
    const canonical = pick('link[rel="canonical"]', "href");
    const robots = pick('meta[name="robots"]');
    const ogTitle = pick('meta[property="og:title"]');
    const ogDesc = pick('meta[property="og:description"]');
    const h1_count = $("h1").length;

    return { title, description, canonical, robots, og_title: ogTitle, og_description: ogDesc, h1_count };
}

async function processDomain(domain, n, unique) {
    const rows = await getCdxRows(domain, n, unique);

    if (!rows.length) {
        return { domain, snapshots: [] };
    }

    const snapshots = [];
    for (const row of rows) {
        const snap = makeIdUrl(row.timestamp, row.original);
        try {
            const parsed = await extractFromSnapshot(snap);
            snapshots.push({
                timestamp: row.timestamp,
                snapshot: snap,
                original: row.original,
                status: row.statuscode,
                length: row.length,
                digest: row.digest,
                title: parsed.title,
                description: parsed.description,
                canonical: parsed.canonical,
                robots: parsed.robots,
                og_title: parsed.og_title,
                og_description: parsed.og_description,
                h1_count: parsed.h1_count,
            });
        } catch (e) {
            snapshots.push({
                timestamp: row.timestamp,
                snapshot: snap,
                original: row.original,
                status: row.statuscode,
                length: row.length,
                digest: row.digest,
                title: "",
                description: "",
                canonical: "",
                robots: "",
                og_title: "",
                og_description: "",
                h1_count: 0,
                error: String(e.message || e),
            });
        }
        await sleep(150);
    }

    return { domain, snapshots };
}

// API endpoint for bulk extraction
app.post('/api/extract', async (req, res) => {
    const { domains, n = 5, unique = false } = req.body;

    if (!domains || !Array.isArray(domains)) {
        return res.status(400).json({ error: 'Domains array is required' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    for (const domain of domains) {
        try {
            // Send progress update
            res.write(JSON.stringify({ type: 'progress', domain }) + '\n');

            // Process domain
            const result = await processDomain(domain.trim(), n, unique);
            
            // Send result
            res.write(JSON.stringify({ type: 'result', data: result }) + '\n');
        } catch (error) {
            // Send error
            res.write(JSON.stringify({ 
                type: 'error', 
                domain, 
                message: `Erreur pour ${domain}: ${error.message}` 
            }) + '\n');
        }
    }

    res.end();
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📱 Interface web disponible sur http://localhost:${PORT}`);
});