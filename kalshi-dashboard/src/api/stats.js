/**
 * Statistical analysis for Kalshi prediction markets.
 */

/**
 * Compute bid-ask spread from orderbook.
 * Returns { spread, spreadPct, bestBid, bestAsk, midpoint }
 * spread is in cents; spreadPct is relative to midpoint.
 */
export function computeSpread(orderbook) {
  if (!orderbook) return null;

  const yesBids = orderbook.yes || [];
  const noBids = orderbook.no || [];

  // Best yes bid = highest price someone will pay for YES
  // Best no bid = highest price someone will pay for NO
  // YES ask = 100 - best NO bid (you can sell YES by buying NO at complement)
  const bestYesBid = yesBids.length > 0 ? yesBids[0][0] : null;
  const bestNoBid = noBids.length > 0 ? noBids[0][0] : null;

  const bestAsk = bestNoBid != null ? (100 - bestNoBid) : null;
  const bestBid = bestYesBid;

  if (bestBid == null || bestAsk == null) {
    return { spread: null, spreadPct: null, bestBid, bestAsk, midpoint: null, depth: yesBids.length + noBids.length };
  }

  const spread = bestAsk - bestBid;
  const midpoint = (bestBid + bestAsk) / 2;
  const spreadPct = midpoint > 0 ? (spread / midpoint) * 100 : 0;

  return {
    spread,
    spreadPct,
    bestBid,
    bestAsk,
    midpoint,
    depth: yesBids.length + noBids.length,
  };
}

/**
 * Compute price momentum from recent trades.
 * Returns { direction, magnitude, recentAvg, olderAvg, tradeCount, velocity }
 * direction: 'UP', 'DOWN', 'FLAT'
 * magnitude: absolute cents change between recent and older halves
 * velocity: cents change per trade
 */
export function computeMomentum(trades) {
  if (!trades || trades.length < 4) return null;

  const prices = trades.map(t => t.yes_price ?? t.price ?? 0);
  const half = Math.floor(prices.length / 2);

  const recentHalf = prices.slice(0, half);
  const olderHalf = prices.slice(half);

  const recentAvg = recentHalf.reduce((s, v) => s + v, 0) / recentHalf.length;
  const olderAvg = olderHalf.reduce((s, v) => s + v, 0) / olderHalf.length;
  const magnitude = Math.abs(recentAvg - olderAvg);

  // Price velocity: linear regression slope
  const n = prices.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  let direction = 'FLAT';
  if (recentAvg - olderAvg > 1) direction = 'UP';
  else if (olderAvg - recentAvg > 1) direction = 'DOWN';

  return {
    direction,
    magnitude: Math.round(magnitude * 10) / 10,
    recentAvg: Math.round(recentAvg * 10) / 10,
    olderAvg: Math.round(olderAvg * 10) / 10,
    tradeCount: trades.length,
    velocity: Math.round(slope * 100) / 100,
  };
}

/**
 * Detect implied probability mispricing within an event.
 * For events with multiple markets (e.g., "Who will be Pope?"),
 * the sum of YES probabilities should be ~100%.
 * Returns { totalImpliedPct, overround, markets[], isMispriced }
 */
export function detectArbitrage(eventMarkets) {
  if (!eventMarkets || eventMarkets.length < 2) return null;

  const marketsWithPrice = eventMarkets.filter(m => m.last_price != null && m.last_price > 0);
  if (marketsWithPrice.length < 2) return null;

  const totalImpliedPct = marketsWithPrice.reduce((sum, m) => sum + (m.last_price || 0), 0);

  // Overround: how much the total exceeds 100%
  // Positive overround = market is "too expensive" in aggregate
  // Negative overround = market is "too cheap" (opportunity)
  const overround = totalImpliedPct - 100;

  return {
    totalImpliedPct: Math.round(totalImpliedPct * 10) / 10,
    overround: Math.round(overround * 10) / 10,
    marketCount: marketsWithPrice.length,
    isMispriced: Math.abs(overround) > 15, // flag if >15% off
  };
}

/**
 * Compute volume analysis for a market relative to its peers.
 * Takes a market and the full list of event markets.
 * Returns { relativeVolume, volumeRank, isHotVolume }
 */
export function computeVolumeAnalysis(market, allMarkets) {
  const volumes = allMarkets.map(m => m.volume ?? 0).filter(v => v > 0);
  if (volumes.length === 0) return null;

  const avg = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  const vol = market.volume ?? 0;
  const relativeVolume = avg > 0 ? vol / avg : 0;

  const sorted = [...volumes].sort((a, b) => b - a);
  const rank = sorted.indexOf(vol) + 1;

  return {
    volume: vol,
    avgVolume: Math.round(avg),
    relativeVolume: Math.round(relativeVolume * 100) / 100,
    volumeRank: rank,
    totalMarkets: volumes.length,
    isHotVolume: relativeVolume > 2.0,
  };
}

/**
 * Compute divergence between two markets' recent price movements.
 * If two related markets normally move together but have recently diverged,
 * this returns a positive divergence score.
 * Returns { divergence, direction, targetRecent, candidateRecent }
 */
export function computeDivergence(targetTrades, candidateTrades) {
  if (!targetTrades?.length || !candidateTrades?.length) return null;
  if (targetTrades.length < 3 || candidateTrades.length < 3) return null;

  const tPrices = targetTrades.map(t => t.yes_price ?? t.price ?? 0);
  const cPrices = candidateTrades.map(t => t.yes_price ?? t.price ?? 0);

  // Compare recent vs older price difference
  const tRecent = tPrices.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
  const tOlder = tPrices.slice(-3).reduce((s, v) => s + v, 0) / 3;

  const cRecent = cPrices.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
  const cOlder = cPrices.slice(-3).reduce((s, v) => s + v, 0) / 3;

  const tDelta = tRecent - tOlder;
  const cDelta = cRecent - cOlder;

  // Divergence = how differently they moved
  const divergence = Math.abs(tDelta - cDelta);

  let direction = 'NEUTRAL';
  if (tDelta > 1 && cDelta < -1) direction = 'TARGET UP / MATCH DOWN';
  else if (tDelta < -1 && cDelta > 1) direction = 'TARGET DOWN / MATCH UP';
  else if (tDelta > 1 && cDelta > 1 && Math.abs(tDelta - cDelta) > 3) direction = 'BOTH UP (DIVERGING)';
  else if (tDelta < -1 && cDelta < -1 && Math.abs(tDelta - cDelta) > 3) direction = 'BOTH DOWN (DIVERGING)';

  return {
    divergence: Math.round(divergence * 10) / 10,
    direction,
    targetDelta: Math.round(tDelta * 10) / 10,
    candidateDelta: Math.round(cDelta * 10) / 10,
  };
}

/**
 * Format a market into a quick stats summary object.
 */
export function quickStats(market) {
  const price = market.last_price;
  const impliedProb = price != null ? `${price}%` : '--';
  const vol = market.volume ?? 0;
  const oi = market.open_interest ?? 0;

  return { impliedProb, volume: vol, openInterest: oi };
}
