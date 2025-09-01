import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

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

    // Extract complete HTML content for copy-paste reuse
    // Keep the full HTML but clean up Wayback-specific elements
    $('script[src*="web.archive.org"]').remove(); // Remove Wayback scripts
    $('link[href*="web.archive.org"]').remove(); // Remove Wayback styles
    $('.wb-autocomplete-suggestions').remove(); // Remove Wayback suggestions
    $('#wm-ipp-base').remove(); // Remove Wayback toolbar
    $('#donato').remove(); // Remove donation banner
    $('[id*="wm-"]').remove(); // Remove other Wayback elements
    
    return { 
        title, 
        description, 
        canonical, 
        robots, 
        og_title: ogTitle, 
        og_description: ogDesc, 
        h1_count
    };
}


async function analyzeWithPerplexity(title, description, domain, apiKey) {
    if (!apiKey || !title) return null;
    
    try {
        const prompt = `Analyze this website based on its title and description, then categorize it:

Title: "${title}"
Description: "${description || 'N/A'}"
Domain: ${domain}

Categorize this site into ONE of these categories:
- Clean: Professional, legitimate business or informational sites
- Casino/Jeux: Gambling, betting, casino sites
- Contenu adulte: Adult content, dating, explicit material
- Pharma/Santé: Pharmacy, medication, health supplements (often suspicious)
- Finance suspect: Crypto, forex trading, payday loans, get-rich schemes
- Contrefaçon: Fake designer goods, replica products
- Piratage: Software cracks, keygens, pirated content
- Spam générique: Generic spam with clickbait titles
- E-commerce: Legitimate online stores, shopping sites
- Blog/Info: Blogs, news, informational content
- Tech: Technology, software, development sites
- Actualités: News, media sites

Focus on detecting spam/suspicious content. Respond with ONLY the category name (e.g., "Clean" or "Casino/Jeux").`;

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-sonar-small-128k-online',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 50
            })
        });

        if (!response.ok) {
            console.error(`Perplexity API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const category = data.choices?.[0]?.message?.content?.trim();
        
        // Validate category
        const validCategories = [
            'Clean', 'Casino/Jeux', 'Contenu adulte', 'Pharma/Santé', 'Finance suspect', 
            'Contrefaçon', 'Piratage', 'Spam générique', 'E-commerce', 'Blog/Info', 'Tech', 'Actualités'
        ];
        return validCategories.includes(category) ? category : 'Spam/Suspect';
        
    } catch (error) {
        console.error('Perplexity analysis error:', error);
        return null;
    }
}

async function processDomain(domain, n, unique, analyzeContent = false, apiKey = null) {
    const rows = await getCdxRows(domain, n, unique);

    if (!rows.length) {
        return { domain, snapshots: [] };
    }

    const snapshots = [];
    for (const row of rows) {
        const snap = makeIdUrl(row.timestamp, row.original);
        try {
            const parsed = await extractFromSnapshot(snap);
            const snapshot = {
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
            };


            // Add AI analysis if requested
            if (analyzeContent && apiKey && parsed.title) {
                const category = await analyzeWithPerplexity(parsed.title, parsed.description, domain, apiKey);
                if (category) {
                    snapshot.category = category;
                }
                // Small delay between AI calls
                await sleep(500);
            }

            snapshots.push(snapshot);
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

// API endpoint for URL discovery
app.get('/api/discover-urls/:domain', async (req, res) => {
    const domain = req.params.domain;
    
    try {
        // Get all URLs for this domain from Wayback CDX
        const base = new URL("https://web.archive.org/cdx/search/cdx");
        base.searchParams.set("url", domain + "/*");
        base.searchParams.set("output", "json");
        base.searchParams.append("filter", "mimetype:text/html");
        base.searchParams.append("filter", "statuscode:200");
        base.searchParams.set("fl", "timestamp,original");
        base.searchParams.set("limit", "1000"); // Get up to 1000 URLs
        base.searchParams.set("collapse", "urlkey"); // Deduplicate by URL
        
        const response = await fetchRetry(base.toString());
        const json = await response.json();
        
        // Skip header row and format results
        const urls = json.slice(1).map(row => ({
            timestamp: row[0],
            original: row[1],
            snapshot: makeIdUrl(row[0], row[1])
        }));
        
        res.json({ domain, urls });
    } catch (error) {
        console.error(`Error discovering URLs for ${domain}:`, error);
        res.status(500).json({ 
            error: `Erreur lors de la découverte d'URLs pour ${domain}: ${error.message}` 
        });
    }
});


// API endpoint for bulk extraction
app.post('/api/extract', async (req, res) => {
    const { domains, n = 5, unique = false, analyzeContent = false, apiKey = null } = req.body;

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
            const result = await processDomain(domain.trim(), n, unique, analyzeContent, apiKey);
            
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

function startServer(port) {
    app.listen(port, () => {
        console.log(`🚀 Server running at http://localhost:${port}`);
        console.log(`📱 Interface web disponible sur http://localhost:${port}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`❌ Port ${port} is already in use. Trying port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
}

startServer(PORT);