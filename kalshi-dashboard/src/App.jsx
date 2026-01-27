import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import MarketTable from './components/MarketTable'
import MarketDetail from './components/MarketDetail'
import EventList from './components/EventList'
import Scanner from './components/Scanner'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <Header />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<MarketTable />} />
          <Route path="/market/:ticker" element={<MarketDetail />} />
          <Route path="/events" element={<EventList />} />
          <Route path="/scanner" element={<Scanner />} />
        </Routes>
      </main>
    </div>
  )
}
