import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

export default function Header() {
  const location = useLocation();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const ts = time.toLocaleTimeString('en-US', { hour12: false });
  const dt = time.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

  return (
    <header className="header">
      <div className="header-left">
        <Link to="/" className="header-logo">
          <span className="logo-bracket">[</span>
          STCM<span className="logo-dim"> Short Term Capital Management</span>
          <span className="logo-bracket">]</span>
        </Link>
        <nav className="header-nav">
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
            MARKETS
          </Link>
          <Link to="/events" className={location.pathname === '/events' ? 'active' : ''}>
            EVENTS
          </Link>
          <Link to="/scanner" className={location.pathname === '/scanner' ? 'active' : ''}>
            SCANNER
          </Link>
        </nav>
      </div>
      <div className="header-right">
        <span className="header-status">
          <span className="status-dot" />LIVE
        </span>
        <span className="header-time">{dt} {ts}</span>
      </div>
    </header>
  );
}
