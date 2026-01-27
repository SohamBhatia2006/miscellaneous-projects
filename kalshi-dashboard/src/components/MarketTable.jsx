import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchEvents } from '../api/kalshi';
import SearchBar from './SearchBar';

// Sports parlay prefixes to filter out by default
const PARLAY_PREFIXES = ['KXMVESPORTSMULTIGAME', 'KXMVENBASINGLEGAME'];

const CATEGORY_OPTIONS = ['all', 'politics', 'finance', 'science', 'culture', 'sports'];

function formatPrice(cents) {
  if (cents == null) return '  --';
  return String(cents).padStart(3) + '¢';
}

function formatVol(v) {
  if (v == null || v === 0) return '--';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  return String(v);
}

function categorizeEvent(ticker, title) {
  const t = (ticker + ' ' + title).toLowerCase();
  if (PARLAY_PREFIXES.some(p => ticker.startsWith(p))) return 'sports';
  if (/nba|nfl|nhl|mlb|sport|game|score|point|touchdown|rebound/i.test(t)) return 'sports';
  if (/president|senate|congress|elect|governor|politic|trump|biden|party|vote|speaker|leader|g7/i.test(t)) return 'politics';
  if (/s&p|nasdaq|stock|index|fed |rate|inflation|gdp|unemployment|ipo|market share|ev share|bitcoin|crypto/i.test(t)) return 'finance';
  if (/mars|fusion|climate|earthquake|volcano|fda|cure|ai |robot/i.test(t)) return 'science';
  return 'culture';
}

export default function MarketTable() {
  const navigate = useNavigate();
  const [markets, setMarkets] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('volume');
  const [sortDir, setSortDir] = useState('desc');

  const loadMarkets = useCallback(async (append = false, nextCursor = null) => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: 100, status: 'open', withNestedMarkets: true };
      if (nextCursor) params.cursor = nextCursor;

      const data = await fetchEvents(params);
      const events = data.events || [];

      // Flatten events into markets, tagging each with its event info and category
      const flattened = [];
      for (const ev of events) {
        const cat = categorizeEvent(ev.event_ticker || '', ev.title || '');
        for (const m of (ev.markets || [])) {
          flattened.push({
            ...m,
            event_title: ev.title,
            event_ticker: ev.event_ticker,
            category: m._cat || cat,
          });
        }
      }

      setMarkets(prev => append ? [...prev, ...flattened] : flattened);
      setCursor(data.cursor || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMarkets([]);
    setCursor(null);
    loadMarkets(false, null);
  }, [loadMarkets]);

  useEffect(() => {
    const interval = setInterval(() => loadMarkets(false, null), 30000);
    return () => clearInterval(interval);
  }, [loadMarkets]);

  function handleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  // Filter by category (exclude sports parlays by default)
  const catFiltered = categoryFilter === 'all'
    ? markets.filter(m => !PARLAY_PREFIXES.some(p => m.ticker?.startsWith(p)))
    : categoryFilter === 'sports'
    ? markets.filter(m => m.category === 'sports')
    : markets.filter(m => m.category === categoryFilter);

  const filtered = searchQuery
    ? catFiltered.filter(m =>
        m.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.ticker?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.event_title?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : catFiltered;

  const sorted = [...filtered].sort((a, b) => {
    let va, vb;
    switch (sortField) {
      case 'volume': va = a.volume ?? 0; vb = b.volume ?? 0; break;
      case 'yes': va = a.yes_ask ?? a.last_price ?? 0; vb = b.yes_ask ?? b.last_price ?? 0; break;
      case 'no': va = a.no_ask ?? (100 - (a.last_price ?? 0)); vb = b.no_ask ?? (100 - (b.last_price ?? 0)); break;
      case 'last': va = a.last_price ?? 0; vb = b.last_price ?? 0; break;
      case 'ticker': va = a.ticker || ''; vb = b.ticker || ''; break;
      case 'title': va = a.title || ''; vb = b.title || ''; break;
      default: va = 0; vb = 0;
    }
    if (typeof va === 'string') {
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  const sortIcon = (field) => {
    if (sortField !== field) return ' ';
    return sortDir === 'asc' ? '▲' : '▼';
  };

  return (
    <div className="market-table-page">
      <div className="controls">
        <SearchBar onSearch={setSearchQuery} placeholder="filter markets..." />
        <div className="status-filters">
          {CATEGORY_OPTIONS.map(c => (
            <button
              key={c}
              className={`filter-btn ${categoryFilter === c ? 'active' : ''}`}
              onClick={() => setCategoryFilter(c)}
            >
              [{c.toUpperCase()}]
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-msg">ERR: {error}</div>}

      <div className="table-info">
        <span>{sorted.length} markets loaded</span>
        {loading && <span className="blink"> ● FETCHING</span>}
      </div>

      <div className="table-wrap">
        <table className="term-table">
          <thead>
            <tr>
              <th className="col-status">ST</th>
              <th className="col-cat">CAT</th>
              <th className="col-ticker sortable" onClick={() => handleSort('ticker')}>
                TICKER {sortIcon('ticker')}
              </th>
              <th className="col-title sortable" onClick={() => handleSort('title')}>
                MARKET {sortIcon('title')}
              </th>
              <th className="col-price sortable" onClick={() => handleSort('yes')}>
                YES {sortIcon('yes')}
              </th>
              <th className="col-price sortable" onClick={() => handleSort('no')}>
                NO {sortIcon('no')}
              </th>
              <th className="col-price sortable" onClick={() => handleSort('last')}>
                LAST {sortIcon('last')}
              </th>
              <th className="col-vol sortable" onClick={() => handleSort('volume')}>
                VOL {sortIcon('volume')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(m => {
              const yesPrice = m.yes_ask ?? m.last_price;
              const noPrice = m.no_ask ?? (m.last_price != null ? 100 - m.last_price : null);
              return (
                <tr
                  key={m.ticker}
                  className="market-row"
                  onClick={() => navigate(`/market/${m.ticker}`)}
                >
                  <td className="col-status">
                    <span className={`st-dot ${m.status === 'open' ? 'open' : 'closed'}`} />
                  </td>
                  <td className={`col-cat cat-${m.category}`}>{(m.category || '').slice(0, 3).toUpperCase()}</td>
                  <td className="col-ticker mono">{m.ticker?.length > 20 ? m.ticker.slice(0, 20) + '…' : m.ticker}</td>
                  <td className="col-title">{m.title}</td>
                  <td className="col-price yes-text">{formatPrice(yesPrice)}</td>
                  <td className="col-price no-text">{formatPrice(noPrice)}</td>
                  <td className="col-price">{formatPrice(m.last_price)}</td>
                  <td className="col-vol">{formatVol(m.volume)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && sorted.length === 0 && (
        <div className="empty">NO MARKETS FOUND</div>
      )}

      {!loading && cursor && (
        <button className="load-more" onClick={() => loadMarkets(true, cursor)}>
          [LOAD MORE]
        </button>
      )}
    </div>
  );
}
