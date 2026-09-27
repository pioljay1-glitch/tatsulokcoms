/** Per-voice-channel music state (in-memory) */
const musicByChannel = new Map();

export function extractYouTubeId(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1).split('/')[0] || null;
    }
    if (url.hostname.includes('youtube.com')) {
      return url.searchParams.get('v');
    }
  } catch {
    // not a URL
  }
  return null;
}

export function getMusic(channelId) {
  return musicByChannel.get(channelId) || null;
}

export function setMusic(channelId, state) {
  if (!state) musicByChannel.delete(channelId);
  else musicByChannel.set(channelId, state);
  return state;
}

export function registerMusicHandlers(socket, io, user, getSocketUser) {
  socket.on('music:play', (payload) => {
    const info = getSocketUser(socket.id);
    const channelId = info?.voiceChannel;
    if (!channelId) {
      socket.emit('music:error', { error: 'Join a voice channel first to play music.' });
      return;
    }
    const raw = payload?.query || payload?.url || '';
    const videoId = extractYouTubeId(raw);
    if (!videoId) {
      socket.emit('music:error', {
        error: 'Paste a YouTube link or video ID. Example: /play https://youtube.com/watch?v=dQw4w9WgXcQ',
      });
      return;
    }
    const title = payload?.title || `YouTube ${videoId}`;
    const state = {
      videoId,
      title,
      requestedBy: user.displayName,
      username: user.username,
      playing: true,
      channelId,
    };
    setMusic(channelId, state);
    io.to(`voice:${channelId}`).emit('music:state', state);
    io.to(`text:${info.textChannel || 'general'}`).emit('message:new', {
      id: `music-${Date.now()}`,
      channelId: info.textChannel || 'general',
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      text: `Now playing: ${title} (requested by ${user.displayName})`,
      timestamp: new Date().toISOString(),
      system: true,
    });
  });

  socket.on('music:pause', () => {
    const info = getSocketUser(socket.id);
    const channelId = info?.voiceChannel;
    if (!channelId) return;
    const state = getMusic(channelId);
    if (state) {
      state.playing = false;
      io.to(`voice:${channelId}`).emit('music:state', state);
    }
  });

  socket.on('music:resume', () => {
    const info = getSocketUser(socket.id);
    const channelId = info?.voiceChannel;
    if (!channelId) return;
    const state = getMusic(channelId);
    if (state) {
      state.playing = true;
      io.to(`voice:${channelId}`).emit('music:state', state);
    }
  });

  socket.on('music:stop', () => {
    const info = getSocketUser(socket.id);
    const channelId = info?.voiceChannel;
    if (!channelId) return;
    setMusic(channelId, null);
    io.to(`voice:${channelId}`).emit('music:state', null);
  });

  socket.on('music:get', () => {
    const info = getSocketUser(socket.id);
    const channelId = info?.voiceChannel;
    socket.emit('music:state', channelId ? getMusic(channelId) : null);
  });
}
