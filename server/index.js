import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { registerLobbyHandlers } from './socketHandlers/lobbyHandlers.js';

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// In production, serve the built React app from client/dist.
// This way one server handles both the API and the UI.
if (process.env.NODE_ENV === 'production') {
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
  const distPath = path.default.join(__dirname, '../client/dist');
  app.use(express.static(distPath));
  // For any route not matched above, send back index.html (lets React handle routing)
  app.get('*', (_req, res) => res.sendFile(path.default.join(distPath, 'index.html')));
}

// Attach Socket.io to the same HTTP server as Express
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  console.log(`[+] Socket connected:    ${socket.id}`);

  // Register all lobby-related event handlers for this socket
  registerLobbyHandlers(io, socket);

  socket.on('disconnect', (reason) => {
    console.log(`[-] Socket disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
