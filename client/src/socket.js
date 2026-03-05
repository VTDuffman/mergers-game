import { io } from 'socket.io-client';

// Create one Socket.io connection for the entire app.
// autoConnect: false means we manually call socket.connect() in App.jsx,
// giving us control over when the connection is established.
const socket = io({ autoConnect: false });

export default socket;
