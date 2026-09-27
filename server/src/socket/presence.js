/**
 * In-memory presence tracker.
 * Supports multiple sockets per user (multi-device).
 * Only marks a user offline when ALL of their sockets disconnect.
 */

const userSockets = new Map(); // userId -> Set<socketId>
const socketToUser = new Map(); // socketId -> { userId, username, displayName, avatarUrl, textChannel, voiceChannel }
const presence = new Map(); // userId -> { userId, username, displayName, avatarUrl, status, textChannel, voiceChannel, socketIds: Set }

export function addConnection(socket, user) {
  const { id: userId, username, displayName, avatarUrl } = user;
  const socketId = socket.id;

  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socketId);

  socketToUser.set(socketId, {
    userId,
    username,
    displayName,
    avatarUrl: avatarUrl || null,
    textChannel: null,
    voiceChannel: null,
  });

  const existing = presence.get(userId);
  presence.set(userId, {
    userId,
    username,
    displayName,
    avatarUrl: avatarUrl || null,
    status: 'online',
    textChannel: existing?.textChannel || null,
    voiceChannel: existing?.voiceChannel || null,
    socketIds: userSockets.get(userId),
  });

  // Attach to socket for convenience
  socket.userId = userId;
  socket.username = username;
  socket.displayName = displayName;
  socket.avatarUrl = avatarUrl || null;
}

export function removeConnection(socketId) {
  const info = socketToUser.get(socketId);
  if (!info) return null;

  const { userId } = info;
  socketToUser.delete(socketId);

  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      userSockets.delete(userId);
      presence.delete(userId);
      return { userId, wentOffline: true, info };
    }
  }
  return { userId, wentOffline: false, info };
}

export function setTextChannel(socketId, channelId) {
  const info = socketToUser.get(socketId);
  if (!info) return;
  info.textChannel = channelId;
  const p = presence.get(info.userId);
  if (p) p.textChannel = channelId;
}

export function setVoiceChannel(socketId, channelId) {
  const info = socketToUser.get(socketId);
  if (!info) return;
  info.voiceChannel = channelId;
  const p = presence.get(info.userId);
  if (p) p.voiceChannel = channelId;
}

export function getPresenceList() {
  return Array.from(presence.values()).map((p) => ({
    userId: p.userId,
    username: p.username,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    status: p.status,
    textChannel: p.textChannel,
    voiceChannel: p.voiceChannel,
  }));
}

export function getUserPresence(userId) {
  return presence.get(userId) || null;
}

export function getSocketUser(socketId) {
  return socketToUser.get(socketId) || null;
}

export function updateUserProfile(userId, updates) {
  const p = presence.get(userId);
  if (p) {
    if (updates.displayName) p.displayName = updates.displayName;
    if (updates.username) p.username = updates.username;
    if (updates.avatarUrl !== undefined) p.avatarUrl = updates.avatarUrl;
  }
  // Also update all socket mappings
  const sockets = userSockets.get(userId);
  if (sockets) {
    for (const sid of sockets) {
      const info = socketToUser.get(sid);
      if (info) {
        if (updates.displayName) info.displayName = updates.displayName;
        if (updates.username) info.username = updates.username;
        if (updates.avatarUrl !== undefined) info.avatarUrl = updates.avatarUrl;
      }
    }
  }
}
