// Thin client for Kalshi's PUBLIC market-data API. No auth, no account, no money.
// We only read markets so we can resolve fictional bets against real outcomes.
//
// Prices come back as dollar strings ("0.4000" = 40 cents = 40% implied). Volumes
// come back as fixed-point strings ("1234.00"). We parse everything to numbers here
// so the rest of the app never touches the string encoding.

const BASE = 'https://external-api.kalshi.com/trade-api/v2';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET with retry/backoff on rate limits (429) and transient 5xx. Kalshi's public
// limit is ~30 req/s; a full search sweep can approach it, so we self-heal.
async function kalshiGet(path, params = {}, { retries = 3 } = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, v);
    }
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) return res.json();
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < retries) {
            await sleep(400 * Math.pow(2, attempt)); // 400ms, 800ms, 1600ms
            continue;
        }
        const body = await res.text().catch(() => '');
        throw new Error(`Kalshi ${res.status} on ${path}: ${body.slice(0, 200)}`);
    }
}

function num(s) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

// dollars string ("0.4000") -> integer cents (40). Clamped 0..100.
function dollarsToCents(s) {
    return Math.max(0, Math.min(100, Math.round(num(s) * 100)));
}

// Multivariate combo markets (KXMV*) pollute listings and can't be bet on sanely.
function isMultivariate(ticker = '') {
    return ticker.startsWith('KXMV');
}

// Normalize a raw market object into the shape the rest of the app expects.
function normalizeMarket(m) {
    const resolved = m.status === 'settled' || m.status === 'finalized';
    const result = (m.result || '').toLowerCase(); // '', 'yes', 'no', or e.g. 'void'
    return {
        ticker: m.ticker,
        eventTicker: m.event_ticker,
        title: m.title || m.ticker,
        yesSubTitle: m.yes_sub_title || 'Yes',
        noSubTitle: m.no_sub_title || 'No',
        status: m.status,
        resolved,
        // 'yes' | 'no' when cleanly resolved; null when resolved-but-void/unknown -> refund.
        result: resolved ? (result === 'yes' || result === 'no' ? result : null) : undefined,
        yesAskCents: dollarsToCents(m.yes_ask_dollars),
        noAskCents: dollarsToCents(m.no_ask_dollars),
        lastPriceCents: dollarsToCents(m.last_price_dollars),
        volume: num(m.volume_fp),
        closeTime: m.close_time,
        expirationTime: m.expiration_time,
        raw: m,
    };
}

async function getMarket(ticker) {
    const data = await kalshiGet(`/markets/${encodeURIComponent(ticker)}`);
    if (!data.market) return null;
    return normalizeMarket(data.market);
}

async function getEvent(eventTicker) {
    const data = await kalshiGet(`/events/${encodeURIComponent(eventTicker)}`);
    return data.event || null;
}

// Best-effort search: page open events client-side and substring-match on title /
// subtitle. Kalshi has no public full-text search endpoint. maxPages is high
// enough (200/page) to cover the entire flat open-events feed (~2-3k events) so
// we don't silently miss matches; it early-exits once `limit` matches are found.
// NOTE: individual sports-game markets are NOT in the flat feed — Kalshi only
// exposes them by exact ticker/series — so those won't appear in search results.
async function searchEvents(query, { limit = 8, maxPages = 12 } = {}) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = [];
    let cursor;
    for (let page = 0; page < maxPages && matches.length < limit; page++) {
        if (page > 0) await sleep(120); // throttle the sweep to stay well under ~30 req/s
        const data = await kalshiGet('/events', { status: 'open', limit: 200, cursor });
        for (const ev of data.events || []) {
            if (isMultivariate(ev.event_ticker)) continue;
            const hay = `${ev.title} ${ev.sub_title || ''}`.toLowerCase();
            if (terms.every((t) => hay.includes(t))) {
                matches.push(ev);
                if (matches.length >= limit) break;
            }
        }
        cursor = data.cursor;
        if (!cursor) break;
    }
    return matches;
}

async function getEventMarkets(eventTicker) {
    const data = await kalshiGet('/markets', { event_ticker: eventTicker, status: 'open', limit: 100 });
    return (data.markets || []).filter((m) => !isMultivariate(m.ticker)).map(normalizeMarket);
}

// Search that returns bettable MARKETS (not just events). Matches events by
// title/subtitle, then expands each into its open markets. Bounded for a chatbot.
async function searchMarkets(query, { limit = 10 } = {}) {
    const events = await searchEvents(query, { limit: 6 });
    const markets = [];
    for (const ev of events) {
        let evMarkets = [];
        try {
            evMarkets = await getEventMarkets(ev.event_ticker);
        } catch (_) { /* skip this event's markets */ }
        for (const m of evMarkets) {
            markets.push({ ...m, eventTitle: ev.title });
            if (markets.length >= limit) return markets;
        }
    }
    return markets;
}

// Candlesticks for the odds-over-time chart. period_interval is minutes: 1 | 60 | 1440.
// series_ticker is required in the path and lives on the event, not the market.
async function getCandlesticks(seriesTicker, ticker, { periodInterval = 60, lookbackSeconds = 7 * 24 * 3600 } = {}) {
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - lookbackSeconds;
    const data = await kalshiGet(
        `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`,
        { start_ts: startTs, end_ts: endTs, period_interval: periodInterval }
    );
    return data.candlesticks || [];
}

module.exports = {
    getMarket,
    getEvent,
    getEventMarkets,
    searchEvents,
    searchMarkets,
    getCandlesticks,
    dollarsToCents,
    isMultivariate,
};
