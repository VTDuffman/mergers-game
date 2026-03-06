import { io } from 'socket.io-client';

// In production (Vercel), VITE_SERVER_URL points to the Railway server URL.
// In development, it's undefined, so we fall back to '' which lets the
// Vite dev proxy handle the connection transparently.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

// Create one Socket.io connection for the entire app.
// autoConnect: false means we manually call socket.connect() in App.jsx,
// giving us control over when the connection is established.
const socket = io(SERVER_URL, { autoConnect: false });

export default socket;
