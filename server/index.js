import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
// NOT IN USE — these Socket.io handlers are a legacy artifact from an earlier architecture
// where the game ran over WebSockets. All game actions now flow through REST routes
// (server/routes/games.js) with client-side polling. The handlers are still imported
// to avoid a startup crash (they reference shared game modules), but no client emits
// the events they listen for. Safe to delete in a future cleanup pass.
import { registerLobbyHandlers } from './socketHandlers/lobbyHandlers.js';
import { registerGameHandlers }  from './socketHandlers/gameHandlers.js';
import authRouter   from './routes/auth.js';
import gamesRouter  from './routes/games.js';
import invitesRouter from './routes/invites.js';

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// ---- REST API Routes ----
// Must be registered BEFORE the production static-file wildcard below,
// or the wildcard catch-all will intercept /api/* requests.
app.use('/api/auth',    authRouter);
app.use('/api/games',   gamesRouter);
app.use('/api/invites', invitesRouter);

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

  // Register event handlers for this socket
  registerLobbyHandlers(io, socket);
  registerGameHandlers(io, socket);

  socket.on('disconnect', (reason) => {
    console.log(`[-] Socket disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
