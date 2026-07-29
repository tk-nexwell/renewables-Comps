// scripts/fetch-prices.mjs
//
// Pulls quotes + 1 year of daily closes from the Yahoo Finance chart API and
// writes prices.json next to index.html. Runs on GitHub's servers, so there is
// no browser, no cross-origin request and nothing to be blocked by CORS.
//
// Run locally with:  node scripts/fetch-prices.mjs

import { writeFileSync } from "node:fs";

const TICKERS = [
  "GRE.MC",   // Grenergy Renovables
  "ANE.MC",   // Acciona Energía
  "SLR.MC",   // Solaria
  "EDPR.LS",  // EDP Renováveis
  "ENER.MC",  // Ecoener
  "ERG.MI",   // ERG
  "SCATC.OL", // Scatec
  "EKT.DE",   // Energiekontor
  "VLTSA.PA", // Voltalia
  "IBE.MC",   // Iberdrola
  "ELE.MC",   // Endesa
  "ENEL.MI",  // Enel
];
const FX_TICKER = "EURNOK=X";

const UA = "Mozilla/5.0 (compatible; comps-dashboard/1.0)";
const url = t =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1y&interval=1d`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pull(ticker, attempt = 1) {
  try {
    const res = await fetch(url(ticker), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r?.meta || typeof r.meta.regularMarketPrice !== "number") throw new Error("no price in payload");

    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const stamps = r.timestamp ?? [];
    const hist = [], ts = [];
    closes.forEach((v, i) => {
      if (typeof v === "number" && Number.isFinite(v)) { hist.push(Math.round(v * 1e4) / 1e4); ts.push(stamps[i]); }
    });

    // NOTE: meta.chartPreviousClose on a 1y range is the close BEFORE the range
    // starts — i.e. a year ago, not yesterday. Use the prior daily close instead.
    return {
      px: r.meta.regularMarketPrice,
      prev: hist.length > 1 ? hist[hist.length - 2] : (r.meta.chartPreviousClose ?? null),
      ccy: r.meta.currency ?? null,
      hist,
      ts,
    };
  } catch (err) {
    if (attempt < 3) { await sleep(1200 * attempt); return pull(ticker, attempt + 1); }
    console.error(`  ${ticker}: FAILED — ${err.message}`);
    return null;
  }
}

const quotes = {};
let ok = 0;

for (const t of TICKERS) {
  const q = await pull(t);
  if (q) { quotes[t] = q; ok++; console.log(`  ${t}: ${q.px} ${q.ccy ?? ""} (${q.hist.length} closes)`); }
  await sleep(350);              // be polite; Yahoo rate-limits bursts
}

const fxQuote = await pull(FX_TICKER);
const fx = { EURNOK: fxQuote?.px ?? null };
if (fx.EURNOK) console.log(`  ${FX_TICKER}: ${fx.EURNOK}`);

// Refuse to overwrite a good file with a bad one — if most tickers failed,
// exit non-zero and leave the previous prices.json in place.
if (ok < Math.ceil(TICKERS.length / 2)) {
  console.error(`Only ${ok}/${TICKERS.length} tickers returned. Keeping the existing prices.json.`);
  process.exit(1);
}

writeFileSync(
  "prices.json",
  JSON.stringify({ updated: new Date().toISOString(), fx, quotes }, null, 0)
);
console.log(`Wrote prices.json — ${ok}/${TICKERS.length} tickers.`);
