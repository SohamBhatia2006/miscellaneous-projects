import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchMarket, fetchOrderbook, fetchTrades } from '../api/kalshi';
import { computeSpread, computeMomentum } from '../api/stats';
import CorrelationChart from './CorrelationChart';

function formatPrice(cents) {
  if (cents == null) return '--';
  return `${cents}¢`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatTime(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function StatsPanel({ orderbook, trades, market }) {
  const spread = useMemo(() => computeSpread(orderbook), [orderbook]);
  const momentum = useMemo(() => computeMomentum(trades), [trades]);

  const impliedProb = market.last_price != null ? market.last_price : null;

  return (
    <div className="stats-panel">
      <div className="section-header"><h3>STATISTICS</h3></div>
      <div className="stats-grid">
        <div className="stat-cell">
          <span className="stat-cell-label">IMPLIED PROB</span>
          <span className="stat-cell-value">{impliedProb != null ? `${impliedProb}%` : '--'}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell-label">BID / ASK</span>
          <span className="stat-cell-value">
            {spread?.bestBid != null ? `${spread.bestBid}` : '--'}
            {' / '}
            {spread?.bestAsk != null ? `${spread.bestAsk}` : '--'}
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell-label">SPREAD</span>
          <span className={`stat-cell-value ${spread?.spreadPct > 20 ? 'no-text' : spread?.spreadPct > 10 ? 'yellow-text' : ''}`}>
            {spread?.spread != null ? `${spread.spread}¢` : '--'}
          </span>
          <span className="stat-cell-sub">
            {spread?.spreadPct != null ? `${spread.spreadPct.toFixed(1)}%` : ''}
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell-label">BOOK DEPTH</span>
          <span className="stat-cell-value">{spread?.depth ?? '--'}</span>
          <span className="stat-cell-sub">levels</span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell-label">MOMENTUM</span>
          <span className={`stat-cell-value ${momentum?.direction === 'UP' ? 'yes-text' : momentum?.direction === 'DOWN' ? 'no-text' : ''}`}>
            {momentum?.direction ?? '--'}
          </span>
          <span className="stat-cell-sub">
            {momentum?.magnitude != null ? `Δ${momentum.magnitude}¢` : ''}
          </span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell-label">VELOCITY</span>
          <span className={`stat-cell-value ${(momentum?.velocity ?? 0) > 0 ? 'yes-text' : (momentum?.velocity ?? 0) < 0 ? 'no-text' : ''}`}>
            {momentum?.velocity != null ? `${momentum.velocity > 0 ? '+' : ''}${momentum.velocity}` : '--'}
          </span>
          <span className="stat-cell-sub">¢/trade</span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell-label">TRADES</span>
          <span className="stat-cell-value">{momentum?.tradeCount ?? '--'}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-cell-label">MIDPOINT</span>
          <span className="stat-cell-value">{spread?.midpoint != null ? `${spread.midpoint}¢` : '--'}</span>
        </div>
      </div>
    </div>
  );
}

export default function MarketDetail() {
  const { ticker } = useParams();
  const [market, setMarket] = useState(null);
  const [orderbook, setOrderbook] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [mktRes, obRes, trRes] = await Promise.all([
          fetchMarket(ticker),
          fetchOrderbook(ticker),
          fetchTrades(ticker, { limit: 30 }),
        ]);
        if (cancelled) return;
        setMarket(mktRes.market);
        setOrderbook(obRes.orderbook);
        setTrades(trRes.trades || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [ticker]);

  if (loading && !market) return <div className="loading blink">LOADING MARKET DATA...</div>;
  if (error) return <div className="error-msg">ERR: {error}</div>;
  if (!market) return <div className="empty">MARKET NOT FOUND</div>;

  const yesPrice = market.yes_ask ?? market.last_price;
  const noPrice = market.no_ask ?? (market.last_price != null ? 100 - market.last_price : null);

  return (
    <div className="market-detail">
      <Link to="/" className="back-link">&lt;-- BACK TO MARKETS</Link>

      {/* Top Bar */}
      <div className="detail-top">
        <div className="detail-title-row">
          <span className={`st-dot ${market.status === 'open' ? 'open' : 'closed'}`} />
          <span className="detail-ticker">{market.ticker}</span>
          <span className="detail-status">[{market.status?.toUpperCase()}]</span>
        </div>
        <h2 className="detail-title">{market.title}</h2>
        {market.subtitle && <p className="detail-subtitle">{market.subtitle}</p>}
      </div>

      {/* Price Boxes */}
      <div className="price-strip">
        <div className="price-cell yes">
          <span className="price-cell-label">YES</span>
          <span className="price-cell-value">{formatPrice(yesPrice)}</span>
        </div>
        <div className="price-cell no">
          <span className="price-cell-label">NO</span>
          <span className="price-cell-value">{formatPrice(noPrice)}</span>
        </div>
        <div className="price-cell neutral">
          <span className="price-cell-label">LAST</span>
          <span className="price-cell-value">{formatPrice(market.last_price)}</span>
        </div>
        <div className="price-cell neutral">
          <span className="price-cell-label">VOL</span>
          <span className="price-cell-value">{(market.volume ?? 0).toLocaleString()}</span>
        </div>
        <div className="price-cell neutral">
          <span className="price-cell-label">OI</span>
          <span className="price-cell-value">{(market.open_interest ?? 0).toLocaleString()}</span>
        </div>
      </div>

      {/* Meta */}
      <div className="detail-meta">
        <div><span className="dim">EVENT:</span> {market.event_ticker || '--'}</div>
        <div><span className="dim">CLOSE:</span> {formatDate(market.close_time)}</div>
        <div><span className="dim">EXPIRY:</span> {formatDate(market.expiration_time)}</div>
      </div>

      {/* Stats Panel */}
      <StatsPanel orderbook={orderbook} trades={trades} market={market} />

      {/* Correlation Chart */}
      <CorrelationChart ticker={ticker} title={market.title} eventTicker={market.event_ticker} />

      {/* Split: Orderbook + Trades */}
      <div className="detail-split">
        {/* Orderbook */}
        <div className="panel">
          <div className="section-header"><h3>ORDER BOOK</h3></div>
          {orderbook ? (
            <div className="ob-split">
              <div className="ob-col">
                <div className="ob-col-header yes-text">YES BIDS</div>
                <table className="term-table compact">
                  <thead><tr><th>PX</th><th>QTY</th></tr></thead>
                  <tbody>
                    {(orderbook.yes || []).slice(0, 12).map((level, i) => (
                      <tr key={i}>
                        <td className="yes-text mono">{level[0]}¢</td>
                        <td className="mono">{level[1]}</td>
                      </tr>
                    ))}
                    {(!orderbook.yes || orderbook.yes.length === 0) && (
                      <tr><td colSpan={2} className="dim">EMPTY</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="ob-col">
                <div className="ob-col-header no-text">NO BIDS</div>
                <table className="term-table compact">
                  <thead><tr><th>PX</th><th>QTY</th></tr></thead>
                  <tbody>
                    {(orderbook.no || []).slice(0, 12).map((level, i) => (
                      <tr key={i}>
                        <td className="no-text mono">{level[0]}¢</td>
                        <td className="mono">{level[1]}</td>
                      </tr>
                    ))}
                    {(!orderbook.no || orderbook.no.length === 0) && (
                      <tr><td colSpan={2} className="dim">EMPTY</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="dim">NO ORDERBOOK DATA</div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="panel">
          <div className="section-header"><h3>RECENT TRADES</h3></div>
          {trades.length > 0 ? (
            <table className="term-table compact">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>SIDE</th>
                  <th>PX</th>
                  <th>QTY</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={t.trade_id || i}>
                    <td className="mono dim">{formatTime(t.created_time)}</td>
                    <td className={t.taker_side === 'yes' ? 'yes-text' : 'no-text'}>
                      {t.taker_side?.toUpperCase() || '--'}
                    </td>
                    <td className="mono">{formatPrice(t.yes_price)}</td>
                    <td className="mono">{t.count ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="dim">NO RECENT TRADES</div>
          )}
        </div>
      </div>
    </div>
  );
}
