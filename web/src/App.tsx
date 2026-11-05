import { Route, Routes } from 'react-router-dom';
import EventsPage from './pages/Events';
import EventDetailPage from './pages/EventDetail';
import ReplayPage from './pages/Replay';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EventsPage />} />
      <Route path="/event/:id" element={<EventDetailPage />} />
      <Route path="/replay/:date/:hash" element={<ReplayPage />} />
    </Routes>
  );
}
