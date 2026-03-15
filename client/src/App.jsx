import React, { useState } from 'react';
import Landing from './pages/Landing.jsx';
import Workspace from './pages/Workspace.jsx';

export default function App() {
  const [session, setSession] = useState(null);
  // session = { roomCode, userId, room, userName, userRole }

  if (!session) return <Landing onJoin={setSession} />;
  return <Workspace session={session} onLeave={() => setSession(null)} />;
}
