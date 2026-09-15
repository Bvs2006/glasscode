import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { signToken, verifyToken, VALID_ROLES, type UserRole } from './auth.js';
import { setupConnection, docs } from './y-websocket-server.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 1234;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    roomsActive: docs.size,
    timestamp: new Date().toISOString(),
  });
});

// Mint JWT tokens with role claims
app.get('/auth/token', (req, res) => {
  const role = (req.query.role as UserRole) || 'editor';
  const userId = (req.query.userId as string) || `user-${Math.random().toString(36).substring(2, 7)}`;
  const name = (req.query.name as string) || `User (${role})`;
  const color = (req.query.color as string) || '#3b82f6';

  if (!VALID_ROLES.includes(role as UserRole)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  const token = signToken({ userId, role, name, color });
  return res.json({ token, userId, role, name, color });
});

app.post('/auth/token', (req, res) => {
  const { role = 'editor', userId = `user-${Math.random().toString(36).substring(2, 7)}`, name, color } = req.body;

  if (!VALID_ROLES.includes(role as UserRole)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
  }

  const token = signToken({
    userId,
    role,
    name: name || `User (${role})`,
    color: color || '#3b82f6',
  });

  return res.json({ token, userId, role, name, color });
});

// Verify token endpoint
app.post('/auth/verify', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  return res.json({ valid: true, payload });
});

// Create HTTP and WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  // Room name is pathname without leading slash e.g. "my-project-room"
  const docName = url.pathname.slice(1) || 'default-room';

  wss.handleUpgrade(request, socket, head, (ws) => {
    setupConnection(ws, request, docName);
  });
});

// Heartbeat / ping interval (every 30s)
const interval = setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log(`[SyncServer] Live-Share Yjs server running at http://localhost:${PORT}`);
  console.log(`[SyncServer] WebSocket endpoint ready at ws://localhost:${PORT}/<roomName>`);
});
