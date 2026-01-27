import { useState, useEffect, useCallback } from 'react';
import { fetchEvents } from '../api/kalshi';
import SearchBar from './SearchBar';
import { Link } from 'react-router-dom';

export default function EventList() {
  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadEvents = useCallback(async (append = false, nextCursor = null) => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: 20, status: 'open', withNestedMarkets: true };
      if (nextCursor) params.cursor = nextCursor;

      const data = await fetchEvents(params);
      const list = data.events || [];
      setEvents(prev => append ? [...prev, ...list] : list);
      setCursor(data.cursor || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents(false, null);
  }, [loadEvents]);

  const filtered = searchQuery
    ? events.filter(e =>
        e.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.event_ticker?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : events;

  return (
    <div className="event-list-page">
      <div className="controls">
        <SearchBar onSearch={setSearchQuery} placeholder="filter events..." />
      </div>

      {error && <div className="error-msg">ERR: {error}</div>}

      <div className="table-info">
        <span>{filtered.length} events loaded</span>
        {loading && <span className="blink"> ● FETCHING</span>}
      </div>

      <div className="event-grid">
        {filtered.map(ev => (
          <div key={ev.event_ticker} className="event-card">
            <div className="event-card-header">
              <span className="mono dim">{ev.event_ticker}</span>
              <span className="dim">
                {ev.markets?.length || 0} mkt{(ev.markets?.length || 0) !== 1 ? 's' : ''}
              </span>
            </div>
            <h3>{ev.title}</h3>
            {ev.markets && ev.markets.length > 0 && (
              <table className="term-table compact event-market-table">
                <tbody>
                  {ev.markets.slice(0, 6).map(m => (
                    <tr key={m.ticker}>
                      <td>
                        <Link to={`/market/${m.ticker}`} className="event-market-link">
                          {m.title}
                        </Link>
                      </td>
                      <td className="mono yes-text" style={{ textAlign: 'right', width: 60 }}>
                        {m.last_price != null ? `${m.last_price}¢` : '--'}
                      </td>
                    </tr>
                  ))}
                  {ev.markets.length > 6 && (
                    <tr>
                      <td colSpan={2} className="dim">
                        +{ev.markets.length - 6} more markets
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {!loading && filtered.length === 0 && <div className="empty">NO EVENTS FOUND</div>}
      {!loading && cursor && (
        <button className="load-more" onClick={() => loadEvents(true, cursor)}>
          [LOAD MORE]
        </button>
      )}
    </div>
  );
}
