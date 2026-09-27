import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

function extractYouTubeId(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  const cleaned = s.replace(/^["']|["']$/g, '');
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleaned)) return cleaned;
  try {
    const url = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0].split('?')[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
        const id = parts[1].split('?')[0];
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
      }
    }
  } catch {
    const m = cleaned.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function isBareYouTubeUrl(text) {
  const t = text.trim();
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com|m\.youtube\.com)\//i.test(t);
}

export function SocketProvider({ children }) {
  const { user, isAuthenticated, handleAuthError } = useAuth();
  const socketRef = useRef(null);
  const [socketId, setSocketId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState([]);
  const [messages, setMessages] = useState({});
  const [currentTextChannel, setCurrentTextChannel] = useState('general');
  const [currentVoiceChannel, setCurrentVoiceChannel] = useState(null);
  const [voicePeers, setVoicePeers] = useState([]);
  const [music, setMusic] = useState(null);
  const [musicError, setMusicError] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(null);
  const [activeCallPeer, setActiveCallPeer] = useState(null);
  const [callError, setCallError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketId(null);
        setConnected(false);
        setPresence([]);
        setVoicePeers([]);
        setCurrentVoiceChannel(null);
        setMusic(null);
        setIncomingCall(null);
        setOutgoingCall(null);
        setActiveCallPeer(null);
      }
      return;
    }

    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setSocketId(socket.id);
      socket.emit('channel:join', currentTextChannel || 'general');
    });
    socket.on('disconnect', () => {
      setConnected(false);
      setSocketId(null);
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') handleAuthError({ status: 401 });
    });
    socket.on('presence:list', (list) => setPresence(list || []));
    socket.on('presence:update', (list) => setPresence(list || []));
    socket.on('message:new', (msg) => {
      setMessages((prev) => {
        const ch = msg.channelId;
        const existing = prev[ch] || [];
        if (existing.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [ch]: [...existing, msg] };
      });
    });
    socket.on('voice:peers', (peers) => setVoicePeers(peers || []));
    socket.on('voice:user-joined', (peer) => {
      setVoicePeers((prev) => prev.some((p) => p.socketId === peer.socketId) ? prev : [...prev, peer]);
    });
    socket.on('voice:user-left', ({ socketId: sid }) => {
      setVoicePeers((prev) => prev.filter((p) => p.socketId !== sid));
    });
    socket.on('music:state', (state) => { setMusic(state); setMusicError(null); });
    socket.on('music:error', (payload) => setMusicError(payload?.error || 'Music error'));

    socket.on('call:incoming', (payload) => {
      setIncomingCall(payload);
      setCallError(null);
    });
    socket.on('call:ringing', (payload) => {
      setOutgoingCall(payload);
      setCallError(null);
    });
    socket.on('call:accepted', () => {
      setOutgoingCall(null);
    });
    socket.on('call:joined', ({ roomId, peerSocketId }) => {
      setIncomingCall(null);
      setOutgoingCall(null);
      setActiveCallPeer(peerSocketId);
      socket.emit('voice:join', roomId);
      setCurrentVoiceChannel(roomId);
    });
    socket.on('call:declined', () => {
      setOutgoingCall(null);
      setCallError('Call declined');
    });
    socket.on('call:ended', () => {
      setIncomingCall(null);
      setOutgoingCall(null);
      setActiveCallPeer(null);
      setCurrentVoiceChannel(null);
      setVoicePeers([]);
    });
    socket.on('call:error', (payload) => {
      setCallError(payload?.error || 'Call failed');
      setOutgoingCall(null);
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [isAuthenticated, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const joinTextChannel = useCallback((channelId) => {
    setCurrentTextChannel(channelId);
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('channel:join', channelId);
      s.emit('messages:history', { channelId, limit: 50 }, (res) => {
        if (res?.messages) setMessages((prev) => ({ ...prev, [channelId]: res.messages }));
      });
    }
  }, []);

  const startMusicLocal = useCallback((videoId, query) => {
    setMusic({
      videoId,
      title: `YouTube ${videoId}`,
      requestedBy: user?.displayName || 'You',
      username: user?.username,
      playing: true,
      channelId: currentVoiceChannel,
    });
    setMusicError(null);
    socketRef.current?.emit('music:play', { query: query || videoId });
  }, [user, currentVoiceChannel]);

  const sendMessage = useCallback((text) => {
    return new Promise((resolve, reject) => {
      const s = socketRef.current;
      if (!s?.connected) return reject(new Error('Not connected'));
      const trimmed = text.trim();

      const playMatch = trimmed.match(/^\/play\s+(.+)$/i);
      if (playMatch) {
        const query = playMatch[1].trim();
        const videoId = extractYouTubeId(query);
        if (videoId) startMusicLocal(videoId, query);
        else s.emit('music:play', { query });
        resolve({ system: true });
        return;
      }

      if (isBareYouTubeUrl(trimmed)) {
        const videoId = extractYouTubeId(trimmed);
        if (videoId) {
          startMusicLocal(videoId, trimmed);
          resolve({ system: true });
          return;
        }
      }

      if (/^\/pause$/i.test(trimmed)) {
        setMusic((m) => (m ? { ...m, playing: false } : m));
        s.emit('music:pause');
        resolve({ system: true });
        return;
      }
      if (/^\/resume$/i.test(trimmed)) {
        setMusic((m) => (m ? { ...m, playing: true } : m));
        s.emit('music:resume');
        resolve({ system: true });
        return;
      }
      if (/^\/(stop|skip)$/i.test(trimmed)) {
        setMusic(null);
        s.emit('music:stop');
        resolve({ system: true });
        return;
      }

      s.emit('message:send', { channelId: currentTextChannel, text }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res?.message);
      });
    });
  }, [currentTextChannel, startMusicLocal]);

  const joinVoice = useCallback((channelId) => {
    const s = socketRef.current;
    if (!s?.connected) return;
    s.emit('voice:join', channelId);
    setCurrentVoiceChannel(channelId);
    s.emit('music:get');
  }, []);

  const leaveVoice = useCallback(() => {
    socketRef.current?.emit('voice:leave');
    setCurrentVoiceChannel(null);
    setVoicePeers([]);
    setMusic(null);
    setActiveCallPeer(null);
  }, []);

  const sendSignal = useCallback((to, signal) => {
    socketRef.current?.emit('voice:signal', { to, signal });
  }, []);

  const onSignal = useCallback((handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    s.on('voice:signal', handler);
    return () => s.off('voice:signal', handler);
  }, []);

  const pauseMusic = useCallback(() => {
    setMusic((m) => (m ? { ...m, playing: false } : m));
    socketRef.current?.emit('music:pause');
  }, []);
  const resumeMusic = useCallback(() => {
    setMusic((m) => (m ? { ...m, playing: true } : m));
    socketRef.current?.emit('music:resume');
  }, []);
  const stopMusic = useCallback(() => {
    setMusic(null);
    socketRef.current?.emit('music:stop');
  }, []);

  const startCall = useCallback((toUserId) => {
    setCallError(null);
    socketRef.current?.emit('call:invite', { toUserId });
  }, []);

  const acceptCall = useCallback(() => {
    if (!incomingCall) return;
    socketRef.current?.emit('call:accept', { fromSocketId: incomingCall.fromSocketId });
  }, [incomingCall]);

  const declineCall = useCallback(() => {
    if (incomingCall) {
      socketRef.current?.emit('call:decline', { fromSocketId: incomingCall.fromSocketId });
    }
    setIncomingCall(null);
  }, [incomingCall]);

  const endCall = useCallback(() => {
    if (activeCallPeer) {
      socketRef.current?.emit('call:end', { peerSocketId: activeCallPeer });
    }
    socketRef.current?.emit('voice:leave');
    setActiveCallPeer(null);
    setOutgoingCall(null);
    setIncomingCall(null);
    setCurrentVoiceChannel(null);
    setVoicePeers([]);
  }, [activeCallPeer]);

  const value = {
    socket: socketRef.current,
    socketId,
    connected,
    presence,
    messages: messages[currentTextChannel] || [],
    allMessages: messages,
    currentTextChannel,
    currentVoiceChannel,
    voicePeers,
    music,
    musicError,
    incomingCall,
    outgoingCall,
    activeCallPeer,
    callError,
    joinTextChannel,
    sendMessage,
    joinVoice,
    leaveVoice,
    sendSignal,
    onSignal,
    pauseMusic,
    resumeMusic,
    stopMusic,
    startCall,
    acceptCall,
    declineCall,
    endCall,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}
