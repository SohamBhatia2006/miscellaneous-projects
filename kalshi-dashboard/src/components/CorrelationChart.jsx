import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { fetchTrades, fetchEvents } from '../api/kalshi';
import { computeRelatedness, pearsonCorrelation, normalizeSeries } from '../api/correlation';

const COLORS = ['#00ff41', '#ff6b6b', '#6c5ce7', '#fdcb6e', '#00cec9', '#e17055', '#fd79a8', '#55efc4'];
const MAX_RESULTS = 8;
const MAX_CHART_LINES = 5;
const TRADE_LIMIT = 50;

export default function CorrelationChart({ ticker, title, eventTicker }) {
  const [related, setRelated] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [chartKeys, setChartKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Scanning...');

  useEffect(() => {
    let cancelled = false;

    async function compute() {
      setLoading(true);
      setRelated([]);
      setChartData([]);
      setChartKeys([]);
      setStatus('Loading events...');

      try {
        // 1. Fetch events with nested markets (3 pages for breadth)
        const allMarkets = [];
        let cursor = null;

        for (let page = 0; page < 3; page++) {
          if (cancelled) return;
          const params = { limit: 100, status: 'open', withNestedMarkets: true };
          if (cursor) params.cursor = cursor;

          const data = await fetchEvents(params);
          const events = data.events || [];

          for (const ev of events) {
            for (const m of (ev.markets || [])) {
              if (m.ticker !== ticker) {
                allMarkets.push({
                  ...m,
                  event_title: ev.title,
                  event_ticker: ev.event_ticker,
                });
              }
            }
          }

          cursor = data.cursor || null;
          if (!cursor) break;
          setStatus(`Loaded ${allMarkets.length} markets (page ${page + 1})...`);
        }

        if (cancelled) return;
        setStatus(`Scoring ${allMarkets.length} markets...`);

        // 2. Score every market by relatedness
        const targetInfo = { ticker, title, event_ticker: eventTicker, last_price: null };
        // Try to get target's last_price from the pool (it might not be there)
        const scored = allMarkets.map(m => {
          const { score, reason } = computeRelatedness(targetInfo, m);
          return { ...m, score, reason };
        });

        // 3. Filter and sort — must have some relatedness
        scored.sort((a, b) => b.score - a.score);
        const topRelated = scored.filter(m => m.score > 0.05).slice(0, MAX_RESULTS);

        if (cancelled) return;
        setRelated(topRelated);

        if (topRelated.length === 0) {
          setStatus('No related markets found.');
          setLoading(false);
          return;
        }

        // 4. For the top chart-worthy results, fetch trade history and build overlay
        setStatus('Fetching trade data for overlay...');

        const targetTradesRes = await fetchTrades(ticker, { limit: TRADE_LIMIT });
        const targetTrades = (targetTradesRes.trades || []).slice().reverse();

        if (cancelled) return;

        const chartCandidates = topRelated.slice(0, MAX_CHART_LINES);
        const tradeResults = [];

        // Fetch trades in parallel (batch of 5)
        for (let i = 0; i < chartCandidates.length; i += 5) {
          if (cancelled) return;
          const batch = chartCandidates.slice(i, i + 5);
          const promises = batch.map(m =>
            fetchTrades(m.ticker, { limit: TRADE_LIMIT })
              .then(res => ({ ticker: m.ticker, trades: (res.trades || []).slice().reverse() }))
              .catch(() => ({ ticker: m.ticker, trades: [] }))
          );
          const results = await Promise.all(promises);
          tradeResults.push(...results);
        }

        if (cancelled) return;

        // 5. Build chart: use trade index as x-axis, normalized prices
        const targetPrices = targetTrades.map(t => t.yes_price ?? t.price ?? 0);

        if (targetPrices.length < 2) {
          setStatus(`Found ${topRelated.length} related markets (not enough trades for chart)`);
          setLoading(false);
          return;
        }

        const targetNorm = normalizeSeries(targetPrices);
        const len = targetNorm.length;

        const validLines = [];
        const lineData = {};

        for (const tr of tradeResults) {
          const prices = tr.trades.map(t => t.yes_price ?? t.price ?? 0);
          if (prices.length < 2) continue;
          const norm = normalizeSeries(prices);

          // Also compute price correlation if enough data
          const minLen = Math.min(targetPrices.length, prices.length);
          let priceCorr = null;
          if (minLen >= 10) {
            priceCorr = pearsonCorrelation(
              targetPrices.slice(0, minLen),
              prices.slice(0, minLen)
            );
          }

          // Update the related entry with price correlation
          const relEntry = topRelated.find(r => r.ticker === tr.ticker);
          if (relEntry && priceCorr !== null) {
            relEntry.priceCorr = priceCorr;
          }

          validLines.push(tr.ticker);
          lineData[tr.ticker] = norm;
        }

        // Build chart data points
        const data = [];
        for (let i = 0; i < len; i++) {
          const point = { idx: i, [ticker]: targetNorm[i] };
          for (const lt of validLines) {
            const norm = lineData[lt];
            if (norm) {
              // Scale to same x-range
              const scaledIdx = Math.round((i / len) * (norm.length - 1));
              point[lt] = norm[Math.min(scaledIdx, norm.length - 1)];
            }
          }
          data.push(point);
        }

        setChartData(data);
        setChartKeys(validLines);
        setRelated([...topRelated]); // refresh with priceCorr updates
        setStatus(`Found ${topRelated.length} related markets`);
      } catch (err) {
        setStatus(`Error: ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    compute();
    return () => { cancelled = true; };
  }, [ticker, title, eventTicker]);

  return (
    <div className="correlation-section">
      <div className="section-header">
        <h3>RELATED MARKETS</h3>
        <span className="section-status">
          {loading && <span className="blink">● </span>}
          {status}
        </span>
      </div>

      {/* Chart overlay */}
      {chartData.length > 0 && chartKeys.length > 0 && (
        <div className="chart-container">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <XAxis
                dataKey="idx"
                stroke="#3a3f4b"
                tick={{ fill: '#5a5f6b', fontSize: 11, fontFamily: 'monospace' }}
              />
              <YAxis
                stroke="#3a3f4b"
                tick={{ fill: '#5a5f6b', fontSize: 11, fontFamily: 'monospace' }}
                domain={[0, 100]}
                label={{ value: 'NORMALIZED', angle: -90, position: 'insideLeft', fill: '#3a3f4b', fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{
                  background: '#0a0e14',
                  border: '1px solid #1e2330',
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
                labelStyle={{ color: '#5a5f6b' }}
              />
              <ReferenceLine y={50} stroke="#1e2330" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey={ticker}
                stroke={COLORS[0]}
                strokeWidth={2.5}
                dot={false}
                name={`${ticker.slice(0, 20)} (target)`}
              />
              {chartKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[(i + 1) % COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray={i > 2 ? '5 3' : undefined}
                  name={key.slice(0, 25)}
                />
              ))}
              <Legend
                wrapperStyle={{ fontFamily: 'monospace', fontSize: 10 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Related markets table */}
      {related.length > 0 && (
        <div className="corr-table-wrap">
          <table className="term-table compact">
            <thead>
              <tr>
                <th>#</th>
                <th>REASON</th>
                <th>MARKET</th>
                <th>PRICE</th>
                <th>SCORE</th>
                <th>PX CORR</th>
              </tr>
            </thead>
            <tbody>
              {related.map((c, i) => (
                <tr key={c.ticker}>
                  <td className="mono dim">{i + 1}</td>
                  <td className={`reason-tag ${c.reason === 'SAME EVENT' ? 'reason-event' : 'reason-topic'}`}>
                    {c.reason || '--'}
                  </td>
                  <td className="corr-title">
                    <Link to={`/market/${c.ticker}`} className="corr-link">
                      {c.title?.slice(0, 60) || c.ticker}
                    </Link>
                  </td>
                  <td className="mono yes-text">
                    {c.last_price != null ? `${c.last_price}¢` : '--'}
                  </td>
                  <td className="mono">{c.score.toFixed(2)}</td>
                  <td className={`mono ${c.priceCorr != null ? (c.priceCorr > 0 ? 'yes-text' : 'no-text') : 'dim'}`}>
                    {c.priceCorr != null
                      ? `${c.priceCorr > 0 ? '+' : ''}${c.priceCorr.toFixed(3)}`
                      : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
