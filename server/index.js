import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.get('/health', (_req, res) => res.status(200).send('ok'));

// Serve the built client if it exists (production mode)
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

/** code -> { name, hostName, players: Map<socketId, profile> } */
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return rooms.has(code) ? makeCode() : code;
}

function publicInfo(code, room) {
  return { code, name: room.name, host: room.hostName, players: room.players.size };
}

io.on('connection', (socket) => {
  let joinedCode = null;

  function leaveCurrent() {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (room) {
      room.players.delete(socket.id);
      socket.to(joinedCode).emit('player_left', { id: socket.id });
      if (room.players.size === 0) rooms.delete(joinedCode);
    }
    socket.leave(joinedCode);
    joinedCode = null;
  }

  function joinRoom(code, profile, cb) {
    const room = rooms.get(code);
    if (!room) { cb?.({ ok: false, error: 'Server not found. Check the code!' }); return; }
    leaveCurrent();
    joinedCode = code;
    room.players.set(socket.id, profile);
    socket.join(code);
    const others = [...room.players.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, p]) => ({ id, profile: p }));
    cb?.({ ok: true, code, name: room.name, players: others });
    socket.to(code).emit('player_joined', { id: socket.id, profile });
    console.log(`[room ${code}] ${profile?.name ?? 'Player'} joined (${room.players.size} online)`);
  }

  socket.on('create_server', ({ serverName, profile }, cb) => {
    const code = makeCode();
    rooms.set(code, {
      name: String(serverName || 'Fun Server').slice(0, 30),
      hostName: String(profile?.name || 'Player').slice(0, 20),
      players: new Map()
    });
    console.log(`[room ${code}] created: "${serverName}"`);
    joinRoom(code, profile, cb);
  });

  socket.on('join_server', ({ code, profile }, cb) => {
    joinRoom(String(code || '').toUpperCase().trim(), profile, cb);
  });

  socket.on('list_servers', (cb) => {
    cb?.([...rooms.entries()].map(([code, r]) => publicInfo(code, r)));
  });

  socket.on('find_server', (code, cb) => {
    const c = String(code || '').toUpperCase().trim();
    const room = rooms.get(c);
    cb?.(room ? publicInfo(c, room) : null);
  });

  socket.on('state', (data) => {
    if (joinedCode) socket.volatile.to(joinedCode).emit('player_state', { id: socket.id, ...data });
  });

  socket.on('action', (data) => {
    if (joinedCode) socket.to(joinedCode).emit('action', { ...data, from: socket.id });
  });

  socket.on('leave_server', () => leaveCurrent());
  socket.on('disconnect', () => leaveCurrent());
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`[Upon the Sky] multiplayer server running on http://${HOST}:${PORT}`);
});
