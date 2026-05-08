import { Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import Room from './pages/Room';
import Admin from './pages/Admin';
import Spectate from './pages/Spectate';
import './App.css';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/room" element={<Room />} />
      <Route path="/room/:roomId" element={<Room />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/spectate/:roomId" element={<Spectate />} />
    </Routes>
  );
}
