const BASE = '/api';

export async function fetchMarkets({ cursor, limit = 100, status, seriesTicker, eventTicker } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  if (status) params.set('status', status);
  if (seriesTicker) params.set('series_ticker', seriesTicker);
  if (eventTicker) params.set('event_ticker', eventTicker);

  const res = await fetch(`${BASE}/markets?${params}`);
  if (!res.ok) throw new Error(`Markets fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchMarket(ticker) {
  const res = await fetch(`${BASE}/markets/${ticker}`);
  if (!res.ok) throw new Error(`Market fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchOrderbook(ticker) {
  const res = await fetch(`${BASE}/markets/${ticker}/orderbook`);
  if (!res.ok) throw new Error(`Orderbook fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchCandlesticks(ticker, { period = 60, seriesInterval = 1 } = {}) {
  const params = new URLSearchParams();
  params.set('series_ticker', ticker);
  params.set('period_interval', String(period));

  const res = await fetch(`${BASE}/series/${ticker}/markets/${ticker}/candlesticks?${params}`);
  if (!res.ok) {
    // Fallback: try the market-level candlestick endpoint
    const params2 = new URLSearchParams();
    params2.set('period_interval', String(period));
    const res2 = await fetch(`${BASE}/markets/${ticker}/candlesticks?${params2}`);
    if (!res2.ok) throw new Error(`Candlesticks fetch failed: ${res2.status}`);
    return res2.json();
  }
  return res.json();
}

export async function fetchMarketCandlesticks(ticker) {
  const res = await fetch(`${BASE}/markets/${ticker}/candlesticks`);
  if (!res.ok) throw new Error(`Candlesticks fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchTrades(ticker, { cursor, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  params.set('ticker', ticker);

  const res = await fetch(`${BASE}/markets/trades?${params}`);
  if (!res.ok) throw new Error(`Trades fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchEvents({ cursor, limit = 20, status, withNestedMarkets } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  if (status) params.set('status', status);
  if (withNestedMarkets) params.set('with_nested_markets', 'true');

  const res = await fetch(`${BASE}/events?${params}`);
  if (!res.ok) throw new Error(`Events fetch failed: ${res.status}`);
  return res.json();
}

// Fetch all open markets (paginated)
export async function fetchAllOpenMarkets() {
  let allMarkets = [];
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 5; // cap at ~500 markets

  do {
    const data = await fetchMarkets({ limit: 100, status: 'open', cursor });
    const list = data.markets || [];
    allMarkets = allMarkets.concat(list);
    cursor = data.cursor || null;
    pages++;
  } while (cursor && pages < MAX_PAGES);

  return allMarkets;
}
