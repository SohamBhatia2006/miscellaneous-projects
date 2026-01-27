import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchEvents, fetchTrades, fetchOrderbook } from '../api/kalshi';
import { computeRelatedness } from '../api/correlation';
import { computeSpread, computeMomentum, computeDivergence, detectArbitrage } from '../api/stats';

const SORT_OPTIONS = [
  { key: 'score', label: 'RELATEDNESS' },
  { key: 'divergence', label: 'DIVERGENCE' },
  { key: 'spreadPct', label: 'SPREAD' },
  { key: 'momentum', label: 'MOMENTUM' },
  { key: 'volume', label: 'VOLUME' },
];

export default function Scanner() {
  // Reference market
  const [refTicker, setRefTicker] = useState('');
  const [refMarket, setRefMarket] = useState(null);

  // All loaded markets from events
  const [allMarkets, setAllMarkets] = useState([]);
  const [allEvents, setAllEvents] = useState([]);

  // Results
  const [results, setResults] = useState([]);
  const [arbitrageResults, setArbitrageResults] = useState([]);

  // State
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [sortKey, setSortKey] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [minScore, setMinScore] = useState(0);
  const [scanPhase, setScanPhase] = useState('idle'); // idle, loading-events, scoring, fetching-stats, done

  // Load all events on mount
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setStatus('Loading market universe...');
      setScanPhase('loading-events');
      const markets = [];
      const events = [];
      let cursor = null;

      for (let page = 0; page < 5; page++) {
        if (cancelled) return;
        const params = { limit: 100, status: 'open', withNestedMarkets: true };
        if (cursor) params.cursor = cursor;

        try {
          const data = await fetchEvents(params);
          const evts = data.events || [];
          events.push(...evts);

          for (const ev of evts) {
            for (const m of (ev.markets || [])) {
              markets.push({
                ...m,
                event_title: ev.title,
                event_ticker: ev.event_ticker,
              });
            }
          }

          cursor = data.cursor || null;
          if (!cursor) break;
          setStatus(`Loaded ${markets.length} markets (${events.length} events)...`);
        } catch {
          break;
        }
      }

      if (!cancelled) {
        setAllMarkets(markets);
        setAllEvents(events);

        // Run arbitrage scanner
        const arbResults = [];
        for (const ev of events) {
          const arb = detectArbitrage(ev.markets || []);
          if (arb && arb.isMispriced) {
            arbResults.push({ ...arb, event_ticker: ev.event_ticker, event_title: ev.title, markets: ev.markets });
          }
        }
        setArbitrageResults(arbResults);

        setScanPhase('idle');
        setStatus(`Ready — ${markets.length} markets across ${events.length} events`);
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, []);

  // Find reference market from loaded data
  const findRef = useCallback((tickerInput) => {
    const t = tickerInput.trim().toUpperCase();
    return allMarkets.find(m => m.ticker === t) || allMarkets.find(m => m.ticker?.includes(t));
  }, [allMarkets]);

  // Run the scan
  async function runScan() {
    const ref = findRef(refTicker);
    if (!ref) {
      setStatus(`Market "${refTicker}" not found in loaded data. Try a different ticker.`);
      return;
    }

    setRefMarket(ref);
    setLoading(true);
    setScanPhase('scoring');
    setResults([]);

    try {
      // 1. Score all markets
      setStatus('Scoring relatedness...');
      const scored = allMarkets
        .filter(m => m.ticker !== ref.ticker)
        .map(m => {
          const { score, reason } = computeRelatedness(ref, m);
          return { ...m, score, reason };
        })
        .filter(m => m.score > 0.01)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);

      setResults(scored);

      // 2. Fetch detailed stats for top results
      setScanPhase('fetching-stats');
      setStatus('Fetching trade data and orderbooks...');

      // Fetch reference trades
      let refTrades = [];
      try {
        const refTradesRes = await fetchTrades(ref.ticker, { limit: 50 });
        refTrades = refTradesRes.trades || [];
      } catch { /* skip */ }

      // Fetch stats for top 15 in parallel batches
      const top = scored.slice(0, 15);
      for (let i = 0; i < top.length; i += 5) {
        const batch = top.slice(i, i + 5);
        const promises = batch.map(async (m) => {
          const out = { ticker: m.ticker };

          // Trades
          try {
            const tRes = await fetchTrades(m.ticker, { limit: 50 });
            out.trades = tRes.trades || [];
          } catch { out.trades = []; }

          // Orderbook
          try {
            const obRes = await fetchOrderbook(m.ticker);
            out.orderbook = obRes.orderbook;
          } catch { out.orderbook = null; }

          return out;
        });

        const batchResults = await Promise.all(promises);

        // Update results with stats
        for (const br of batchResults) {
          const entry = scored.find(s => s.ticker === br.ticker);
          if (!entry) continue;

          // Spread
          const spread = computeSpread(br.orderbook);
          if (spread) {
            entry.spread = spread.spread;
            entry.spreadPct = spread.spreadPct;
            entry.depth = spread.depth;
          }

          // Momentum
          const mom = computeMomentum(br.trades);
          if (mom) {
            entry.momentumDir = mom.direction;
            entry.momentumMag = mom.magnitude;
            entry.velocity = mom.velocity;
          }

          // Divergence from reference
          const div = computeDivergence(refTrades, br.trades);
          if (div) {
            entry.divergence = div.divergence;
            entry.divDirection = div.direction;
          }
        }

        setResults([...scored]);
        setStatus(`Analyzed ${Math.min(i + 5, top.length)}/${top.length} markets...`);
      }

      setScanPhase('done');
      setStatus(`Scan complete — ${scored.length} related markets found`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Sort results
  const sorted = [...results].sort((a, b) => {
    let va, vb;
    switch (sortKey) {
      case 'score': va = a.score ?? 0; vb = b.score ?? 0; break;
      case 'divergence': va = a.divergence ?? 0; vb = b.divergence ?? 0; break;
      case 'spreadPct': va = a.spreadPct ?? 999; vb = b.spreadPct ?? 999; break;
      case 'momentum': va = Math.abs(a.velocity ?? 0); vb = Math.abs(b.velocity ?? 0); break;
      case 'volume': va = a.volume ?? 0; vb = b.volume ?? 0; break;
      default: va = 0; vb = 0;
    }
    return sortDir === 'desc' ? vb - va : va - vb;
  }).filter(r => r.score >= minScore);

  function handleTickerKey(e) {
    if (e.key === 'Enter') runScan();
  }

  return (
    <div className="scanner-page">
      {/* Reference Input */}
      <div className="scanner-input-section">
        <div className="section-header">
          <h3>CORRELATION SCANNER</h3>
          <span className="section-status">
            {loading && <span className="blink">● </span>}
            {status}
          </span>
        </div>

        <div className="scanner-controls">
          <div className="scanner-input-row">
            <span className="search-prompt">REF $</span>
            <input
              type="text"
              value={refTicker}
              onChange={e => setRefTicker(e.target.value)}
              onKeyDown={handleTickerKey}
              placeholder="enter ticker (e.g. KXNEWPOPE-70)"
              spellCheck={false}
              className="scanner-input"
              list="market-suggestions"
            />
            <button
              className="scan-btn"
              onClick={runScan}
              disabled={loading || !refTicker.trim() || allMarkets.length === 0}
            >
              [SCAN]
            </button>
          </div>

          {/* Quick-pick from loaded markets */}
          <datalist id="market-suggestions">
            {allMarkets.slice(0, 200).map(m => (
              <option key={m.ticker} value={m.ticker} label={m.title?.slice(0, 60)} />
            ))}
          </datalist>

          {/* Sort + filter controls */}
          {results.length > 0 && (
            <div className="scanner-sort-row">
              <span className="dim">SORT:</span>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  className={`filter-btn ${sortKey === opt.key ? 'active' : ''}`}
                  onClick={() => {
                    if (sortKey === opt.key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                    else { setSortKey(opt.key); setSortDir('desc'); }
                  }}
                >
                  {opt.label} {sortKey === opt.key ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                </button>
              ))}
              <span className="dim" style={{ marginLeft: 12 }}>MIN SCORE:</span>
              <input
                type="range"
                min={0}
                max={100}
                value={minScore * 100}
                onChange={e => setMinScore(Number(e.target.value) / 100)}
                className="score-slider"
              />
              <span className="mono dim">{minScore.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Reference market info */}
      {refMarket && (
        <div className="scanner-ref-bar">
          <span className="dim">REFERENCE:</span>
          <span className="yes-text">{refMarket.ticker}</span>
          <span>—</span>
          <span>{refMarket.title}</span>
          <span className="dim">|</span>
          <span className="yes-text">{refMarket.last_price != null ? `${refMarket.last_price}¢` : '--'}</span>
          <span className="dim">| VOL {(refMarket.volume ?? 0).toLocaleString()}</span>
        </div>
      )}

      {/* Scan Results Table */}
      {sorted.length > 0 && (
        <div className="scanner-results">
          <div className="table-info">
            <span>{sorted.length} matches</span>
            {scanPhase === 'fetching-stats' && <span className="blink"> ● ANALYZING</span>}
          </div>

          <div className="table-wrap">
            <table className="term-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>REASON</th>
                  <th>MARKET</th>
                  <th>PRICE</th>
                  <th>VOL</th>
                  <th>SCORE</th>
                  <th>DIVG</th>
                  <th>SPREAD</th>
                  <th>MOM</th>
                  <th>VEL</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.ticker}>
                    <td className="mono dim">{i + 1}</td>
                    <td className={`reason-tag ${r.reason === 'SAME EVENT' ? 'reason-event' : 'reason-topic'}`}>
                      {(r.reason || '--').slice(0, 12)}
                    </td>
                    <td className="col-title">
                      <Link to={`/market/${r.ticker}`} className="corr-link">
                        {r.title?.slice(0, 50) || r.ticker}
                      </Link>
                    </td>
                    <td className="mono yes-text">{r.last_price != null ? `${r.last_price}¢` : '--'}</td>
                    <td className="mono dim">{formatVol(r.volume)}</td>
                    <td className="mono">{r.score.toFixed(2)}</td>
                    <td className={`mono ${r.divergence > 5 ? 'no-text' : r.divergence > 2 ? 'yellow-text' : 'dim'}`}>
                      {r.divergence != null ? r.divergence.toFixed(1) : '--'}
                    </td>
                    <td className={`mono ${r.spreadPct > 20 ? 'no-text' : r.spreadPct > 10 ? 'yellow-text' : 'dim'}`}>
                      {r.spread != null ? `${r.spread}¢` : '--'}
                    </td>
                    <td className={`mono ${r.momentumDir === 'UP' ? 'yes-text' : r.momentumDir === 'DOWN' ? 'no-text' : 'dim'}`}>
                      {r.momentumDir || '--'}
                    </td>
                    <td className={`mono ${(r.velocity ?? 0) > 0 ? 'yes-text' : (r.velocity ?? 0) < 0 ? 'no-text' : 'dim'}`}>
                      {r.velocity != null ? (r.velocity > 0 ? '+' : '') + r.velocity.toFixed(2) : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Arbitrage Scanner */}
      {arbitrageResults.length > 0 && (
        <div className="arb-section">
          <div className="section-header">
            <h3>ARBITRAGE DETECTOR</h3>
            <span className="section-status">{arbitrageResults.length} mispriced events</span>
          </div>

          <div className="table-wrap">
            <table className="term-table">
              <thead>
                <tr>
                  <th>EVENT</th>
                  <th>TITLE</th>
                  <th>MKTS</th>
                  <th>SUM %</th>
                  <th>OVERROUND</th>
                  <th>SIGNAL</th>
                </tr>
              </thead>
              <tbody>
                {arbitrageResults.map(a => (
                  <tr key={a.event_ticker}>
                    <td className="mono dim">{a.event_ticker?.slice(0, 20)}</td>
                    <td className="col-title">{a.event_title?.slice(0, 50)}</td>
                    <td className="mono">{a.marketCount}</td>
                    <td className={`mono ${a.totalImpliedPct > 110 ? 'no-text' : a.totalImpliedPct < 90 ? 'yes-text' : ''}`}>
                      {a.totalImpliedPct}%
                    </td>
                    <td className={`mono ${a.overround > 0 ? 'no-text' : 'yes-text'}`}>
                      {a.overround > 0 ? '+' : ''}{a.overround}%
                    </td>
                    <td className={a.overround < -10 ? 'yes-text' : 'no-text'}>
                      {a.overround < -10 ? 'UNDERPRICED' : a.overround > 10 ? 'OVERPRICED' : 'MISPRICED'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty states */}
      {allMarkets.length === 0 && !loading && (
        <div className="loading blink">LOADING MARKET UNIVERSE...</div>
      )}

      {results.length === 0 && refMarket && !loading && (
        <div className="empty">NO MATCHES FOUND FOR {refMarket.ticker}</div>
      )}
    </div>
  );
}

function formatVol(v) {
  if (v == null || v === 0) return '--';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  return String(v);
}
