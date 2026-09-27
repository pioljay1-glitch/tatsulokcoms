import { Server } from 'socket.io';
import prisma from '../utils/db.js';
import {
  addConnection,
  removeConnection,
  setTextChannel,
  setVoiceChannel,
  getPresenceList,
  getSocketUser,
  getUserSocketIds,
  updateUserProfile,
} from './presence.js';
import { registerMusicHandlers, getMusic } from './music.js';

export function setupSocket(httpServer, sessionMiddleware) {
  const isProd = process.env.NODE_ENV === 'production';
  const clientUrl = process.env.CLIENT_URL || (isProd ? false : 'http://localhost:5173');

  const io = new Server(httpServer, {
    cors: { origin: clientUrl || true, credentials: true },
    allowRequest: (req, callback) => { callback(null, true); },
  });

  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    try {
      const session = socket.request.session;
      if (!session || !session.userId) return next(new Error('Unauthorized'));
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, username: true, displayName: true, email: true, avatarUrl: true, status: true },
      });
      if (!user) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch (err) {
      console.error('Socket auth error:', err);
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`[socket] ${user.username} connected (${socket.id})`);
    addConnection(socket, user);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'online' } }).catch(() => {});
    io.emit('presence:update', getPresenceList());
    socket.emit('presence:list', getPresenceList());

    socket.on('channel:join', (channelId) => {
      if (typeof channelId !== 'string') return;
      const prev = getSocketUser(socket.id)?.textChannel;
      if (prev) socket.leave(`text:${prev}`);
      socket.join(`text:${channelId}`);
      setTextChannel(socket.id, channelId);
      io.emit('presence:update', getPresenceList());
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        const { channelId, text } = payload || {};
        if (!channelId || typeof text !== 'string') {
          if (typeof ack === 'function') ack({ error: 'Invalid payload' });
          return;
        }
        const cleanText = text.trim().slice(0, 2000);
        if (!cleanText) {
          if (typeof ack === 'function') ack({ error: 'Empty message' });
          return;
        }
        const message = await prisma.message.create({
          data: {
            channelId: String(channelId).slice(0, 64),
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            text: cleanText,
          },
        });
        const out = {
          id: message.id,
          channelId: message.channelId,
          userId: message.userId,
          username: message.username,
          displayName: message.displayName,
          text: message.text,
          timestamp: message.timestamp.toISOString(),
          avatarUrl: user.avatarUrl || null,
        };
        io.to(`text:${channelId}`).emit('message:new', out);
        if (typeof ack === 'function') ack({ ok: true, message: out });
      } catch (err) {
        console.error('message:send error:', err);
        if (typeof ack === 'function') ack({ error: 'Failed to send message' });
      }
    });

    socket.on('messages:history', async (payload, ack) => {
      try {
        const { channelId, limit = 50 } = payload || {};
        if (!channelId) {
          if (typeof ack === 'function') ack({ error: 'channelId required' });
          return;
        }
        const messages = await prisma.message.findMany({
          where: { channelId: String(channelId) },
          orderBy: { timestamp: 'desc' },
          take: Math.min(Number(limit) || 50, 100),
        });
        const out = messages.reverse().map((m) => ({
          id: m.id,
          channelId: m.channelId,
          userId: m.userId,
          username: m.username,
          displayName: m.displayName,
          text: m.text,
          timestamp: m.timestamp.toISOString(),
        }));
        if (typeof ack === 'function') ack({ messages: out });
      } catch (err) {
        if (typeof ack === 'function') ack({ error: 'Failed to load history' });
      }
    });

    const leaveVoiceRoom = () => {
      const info = getSocketUser(socket.id);
      if (info?.voiceChannel) {
        socket.to(`voice:${info.voiceChannel}`).emit('voice:user-left', {
          userId: user.id, username: user.username, displayName: user.displayName, socketId: socket.id,
        });
        socket.leave(`voice:${info.voiceChannel}`);
        setVoiceChannel(socket.id, null);
        io.emit('presence:update', getPresenceList());
      }
    };

    socket.on('voice:join', (channelId) => {
      if (typeof channelId !== 'string') return;
      const prev = getSocketUser(socket.id)?.voiceChannel;
      if (prev) {
        socket.leave(`voice:${prev}`);
        socket.to(`voice:${prev}`).emit('voice:user-left', {
          userId: user.id, username: user.username, displayName: user.displayName, socketId: socket.id,
        });
      }
      socket.join(`voice:${channelId}`);
      setVoiceChannel(socket.id, channelId);
      socket.to(`voice:${channelId}`).emit('voice:user-joined', {
        userId: user.id, username: user.username, displayName: user.displayName,
        avatarUrl: user.avatarUrl || null, socketId: socket.id,
      });
      const room = io.sockets.adapter.rooms.get(`voice:${channelId}`);
      const peers = [];
      if (room) {
        for (const sid of room) {
          if (sid === socket.id) continue;
          const peerSocket = io.sockets.sockets.get(sid);
          if (peerSocket?.user) {
            peers.push({
              userId: peerSocket.user.id,
              username: peerSocket.user.username,
              displayName: peerSocket.user.displayName,
              avatarUrl: peerSocket.user.avatarUrl || null,
              socketId: sid,
            });
          }
        }
      }
      socket.emit('voice:peers', peers);
      socket.emit('music:state', getMusic(channelId));
      io.emit('presence:update', getPresenceList());
    });

    socket.on('voice:leave', () => leaveVoiceRoom());

    socket.on('voice:signal', ({ to, signal }) => {
      if (!to || !signal) return;
      io.to(to).emit('voice:signal', {
        from: socket.id, userId: user.id, username: user.username, displayName: user.displayName, signal,
      });
    });

    // ——— Call (1:1) ———
    socket.on('call:invite', ({ toUserId }) => {
      if (!toUserId || toUserId === user.id) return;
      const targets = getUserSocketIds(toUserId);
      if (!targets.length) {
        socket.emit('call:error', { error: 'User is offline' });
        return;
      }
      const payload = {
        fromUserId: user.id,
        fromUsername: user.username,
        fromDisplayName: user.displayName,
        fromAvatarUrl: user.avatarUrl || null,
        fromSocketId: socket.id,
      };
      targets.forEach((sid) => io.to(sid).emit('call:incoming', payload));
      socket.emit('call:ringing', { toUserId });
    });

    socket.on('call:accept', ({ fromSocketId }) => {
      if (!fromSocketId) return;
      const caller = getSocketUser(fromSocketId);
      if (!caller) {
        socket.emit('call:error', { error: 'Caller disconnected' });
        return;
      }
      // Private room for both
      const ids = [user.id, caller.userId].sort();
      const roomId = `call-${ids[0]}-${ids[1]}`;

      // Tell caller accepted
      io.to(fromSocketId).emit('call:accepted', {
        byUserId: user.id,
        byDisplayName: user.displayName,
        bySocketId: socket.id,
        roomId,
      });

      // Both join the call voice room via client joining roomId
      socket.emit('call:joined', { roomId, peerSocketId: fromSocketId });
      io.to(fromSocketId).emit('call:joined', { roomId, peerSocketId: socket.id });
    });

    socket.on('call:decline', ({ fromSocketId }) => {
      if (fromSocketId) {
        io.to(fromSocketId).emit('call:declined', {
          byUserId: user.id,
          byDisplayName: user.displayName,
        });
      }
    });

    socket.on('call:end', ({ peerSocketId }) => {
      if (peerSocketId) {
        io.to(peerSocketId).emit('call:ended', {
          byUserId: user.id,
          byDisplayName: user.displayName,
        });
      }
      leaveVoiceRoom();
    });

    registerMusicHandlers(socket, io, user, getSocketUser);

    socket.on('profile:updated', (updates) => {
      updateUserProfile(user.id, updates);
      io.emit('presence:update', getPresenceList());
    });

    socket.on('disconnect', async () => {
      console.log(`[socket] ${user.username} disconnected (${socket.id})`);
      const result = removeConnection(socket.id);
      const info = result?.info;
      if (info?.voiceChannel) {
        socket.to(`voice:${info.voiceChannel}`).emit('voice:user-left', {
          userId: user.id, username: user.username, displayName: user.displayName, socketId: socket.id,
        });
      }
      if (result?.wentOffline) {
        await prisma.user.update({ where: { id: user.id }, data: { status: 'offline' } }).catch(() => {});
      }
      io.emit('presence:update', getPresenceList());
    });
  });

  return io;
}
