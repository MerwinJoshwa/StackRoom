// socket.js — legacy singleton kept for compatibility
// Workspace.jsx now creates its own per-session socket with forceNew: true
import { io } from 'socket.io-client';
const socket = io('/', { autoConnect: false, transports: ['websocket', 'polling'] });
export default socket;
