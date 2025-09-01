/**
 * Wayback CDX extractor
 * - Fetch the last N snapshots for a domain using Wayback CDX API
 * - For each snapshot, fetch HTML (id_ mode) and extract:
 *   title, meta description, canonical, robots, OG tags, h1_count
 * - Output: console.table + JSON and CSV files in ./out
 *
 * Usage:
 *   node wayback-last.mjs linkuma.com
 *   node wayback-last.mjs linkuma.com --n 5
 *   node wayback-last.mjs linkuma.com --n 5 --unique
 *
 * Flags:
 *   --n <int>       : number of snapshots to fetch (default 5)
 *   --unique        : de-duplicate by digest (collapse=digest) to get last N *content changes*
 */

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

// ----------------------- utils -----------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function ensureOutDir() {
  const out = path.join(__dirname, "out");
  if (!fs.existsSync(out)) fs.mkdirSync(out);
  return out;
}

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    // Escape quotes by doubling them
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ];
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { n: 5, unique: false };
  const [_node, _file, domain, ...rest] = argv;
  if (!domain) {
    console.error("❌ Missing domain. Usage: node wayback-last.mjs <domain> [--n 5] [--unique]");
    process.exit(1);
  }
  args.domain = domain;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--n") {
      const val = parseInt(rest[i + 1], 10);
      if (!Number.isFinite(val) || val <= 0) {
        console.error("❌ --n must be a positive integer");
        process.exit(1);
      }
      args.n = val;
      i++;
    } else if (a === "--unique") {
      args.unique = true;
    }
  }
  return args;
}

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
        // 429/5xx backoff
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

// ----------------------- core -----------------------
async function getCdxRows(domain, n = 5, unique = false) {
  // CDX request
  // - limit=-N  => last N results (most recent)
  // - filter=mimetype:text/html & statuscode:200  => HTML OK only
  // - fl=timestamp,original,mimetype,statuscode,digest,length
  // - fastLatest=true sometimes speeds retrieval of last entries
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
  // First row is header when output=json
  const rows = json.slice(1);
  // Each row is array aligned with fl order
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
  // id_ serves raw, un-rewritten HTML (best for parsing)
  // Ensure no double slashes when original already has scheme
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

async function run(domain, n, unique) {
  console.log(`🔎 Domain: ${domain} | N=${n} | unique(by digest)=${unique}`);
  const rows = await getCdxRows(domain, n, unique);

  if (!rows.length) {
    console.log("No snapshots found for this domain with the current filters.");
    return;
  }

  const out = [];
  for (const row of rows) {
    const snap = makeIdUrl(row.timestamp, row.original);
    try {
      const parsed = await extractFromSnapshot(snap);
      out.push({
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
      // Still push a row with error info, so CSV stays aligned
      out.push({
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
      console.warn(`⚠️ Failed to parse ${snap}: ${e.message || e}`);
    }
    // Be gentle with Wayback; small delay
    await sleep(150);
  }

  console.table(
    out.map((r) => ({
      timestamp: r.timestamp,
      title: r.title.slice(0, 120),
      status: r.status,
      length: r.length,
      digest: r.digest.slice(0, 12) + "...",
      h1_count: r.h1_count,
    }))
  );

  const outDir = ensureOutDir();
  const stamp = `${domain.replace(/[^a-z0-9.-]/gi, "_")}_${nowStamp()}${unique ? "_unique" : ""}`;
  const jsonPath = path.join(outDir, `${stamp}.json`);
  const csvPath = path.join(outDir, `${stamp}.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), "utf8");
  fs.writeFileSync(csvPath, toCSV(out), "utf8");

  console.log("\n📄 Files written:");
  console.log("JSON:", jsonPath);
  console.log("CSV :", csvPath);
}

// ----------------------- entrypoint -----------------------
const { domain, n, unique } = parseArgs(process.argv);
run(domain, n, unique).catch((e) => {
  console.error("💥 Fatal error:", e);
  process.exit(1);
});