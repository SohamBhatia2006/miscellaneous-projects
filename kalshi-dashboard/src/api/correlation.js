/**
 * Pearson correlation — only meaningful with 15+ aligned data points.
 */
export function pearsonCorrelation(seriesA, seriesB) {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 10) return null;

  const a = seriesA.slice(0, n);
  const b = seriesB.slice(0, n);

  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;

  let num = 0, denomA = 0, denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  const denom = Math.sqrt(denomA * denomB);
  if (denom === 0) return 0;
  return num / denom;
}

export function normalizeSeries(prices) {
  if (!prices.length) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  if (range === 0) return prices.map(() => 50);
  return prices.map(p => ((p - min) / range) * 100);
}

/**
 * Extract keywords from a market/event title for topic matching.
 * Strips noise words, returns lowercase tokens.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'do', 'does', 'did', 'have', 'has', 'had', 'having',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'and', 'or', 'not', 'no', 'yes', 'but', 'if', 'than', 'that', 'this',
  'it', 'its', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
  'before', 'after', 'above', 'below', 'between', 'over', 'under',
  'more', 'most', 'other', 'some', 'any', 'all', 'each', 'every',
  'about', 'up', 'out', 'into', 'through', 'during', 'against',
  'next', 'new', 'first', 'last', 'get', 'become', 'per',
]);

export function extractKeywords(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Compute Jaccard similarity between two keyword sets.
 * Returns 0-1 where 1 = identical topics.
 */
export function keywordSimilarity(kwA, kwB) {
  if (!kwA.length || !kwB.length) return 0;
  const setA = new Set(kwA);
  const setB = new Set(kwB);
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = new Set([...kwA, ...kwB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score how related a candidate market is to the target.
 * Combines: same-event bonus, keyword overlap, price-level proximity.
 */
export function computeRelatedness(target, candidate) {
  let score = 0;
  let reason = '';

  // Same event = highest signal
  if (target.event_ticker && target.event_ticker === candidate.event_ticker) {
    score += 0.8;
    reason = 'SAME EVENT';
  }

  // Keyword overlap
  const kwTarget = extractKeywords((target.title || '') + ' ' + (target.event_title || ''));
  const kwCand = extractKeywords((candidate.title || '') + ' ' + (candidate.event_title || ''));
  const kwSim = keywordSimilarity(kwTarget, kwCand);
  if (kwSim > 0) {
    score += kwSim * 0.6;
    if (!reason) reason = `TOPIC ${(kwSim * 100).toFixed(0)}%`;
  }

  // Price proximity (weak signal — same price doesn't mean related, but very
  // different prices are less likely to be substitutes)
  const pTarget = target.last_price;
  const pCand = candidate.last_price;
  if (pTarget != null && pCand != null) {
    const priceDist = Math.abs(pTarget - pCand) / 100;
    score += (1 - priceDist) * 0.1;
  }

  return { score, reason };
}
