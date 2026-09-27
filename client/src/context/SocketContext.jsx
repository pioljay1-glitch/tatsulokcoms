import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user, isAuthenticated, handleAuthError } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState([]);
  const [messages, setMessages] = useState({});
  const [currentTextChannel, setCurrentTextChannel] = useState('general');
  const [currentVoiceChannel, setCurrentVoiceChannel] = useState(null);
  const [voicePeers, setVoicePeers] = useState([]);
  const [music, setMusic] = useState(null);
  const [musicError, setMusicError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
        setPresence([]);
        setVoicePeers([]);
        setCurrentVoiceChannel(null);
        setMusic(null);
      }
      return;
    }

    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('channel:join', currentTextChannel || 'general');
    });
    socket.on('disconnect', () => setConnected(false));
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
    socket.on('voice:user-left', ({ socketId }) => {
      setVoicePeers((prev) => prev.filter((p) => p.socketId !== socketId));
    });
    socket.on('music:state', (state) => { setMusic(state); setMusicError(null); });
    socket.on('music:error', (payload) => setMusicError(payload?.error || 'Music error'));

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [isAuthenticated, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const joinTextChannel = useCallback((channelId) => {
    setCurrentTextChannel(channelId);
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('channel:join', channelId);
      socket.emit('messages:history', { channelId, limit: 50 }, (res) => {
        if (res?.messages) setMessages((prev) => ({ ...prev, [channelId]: res.messages }));
      });
    }
  }, []);

  const sendMessage = useCallback((text) => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket?.connected) return reject(new Error('Not connected'));
      const trimmed = text.trim();
      const playMatch = trimmed.match(/^\/play\s+(.+)$/i);
      if (playMatch) { socket.emit('music:play', { query: playMatch[1].trim() }); resolve({ system: true }); return; }
      if (/^\/pause$/i.test(trimmed)) { socket.emit('music:pause'); resolve({ system: true }); return; }
      if (/^\/resume$/i.test(trimmed)) { socket.emit('music:resume'); resolve({ system: true }); return; }
      if (/^\/(stop|skip)$/i.test(trimmed)) { socket.emit('music:stop'); resolve({ system: true }); return; }
      socket.emit('message:send', { channelId: currentTextChannel, text }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res?.message);
      });
    });
  }, [currentTextChannel]);

  const joinVoice = useCallback((channelId) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit('voice:join', channelId);
    setCurrentVoiceChannel(channelId);
    socket.emit('music:get');
  }, []);

  const leaveVoice = useCallback(() => {
    socketRef.current?.emit('voice:leave');
    setCurrentVoiceChannel(null);
    setVoicePeers([]);
    setMusic(null);
  }, []);

  const sendSignal = useCallback((to, signal) => {
    socketRef.current?.emit('voice:signal', { to, signal });
  }, []);

  const onSignal = useCallback((handler) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on('voice:signal', handler);
    return () => socket.off('voice:signal', handler);
  }, []);

  const pauseMusic = useCallback(() => socketRef.current?.emit('music:pause'), []);
  const resumeMusic = useCallback(() => socketRef.current?.emit('music:resume'), []);
  const stopMusic = useCallback(() => socketRef.current?.emit('music:stop'), []);

  const value = {
    socket: socketRef.current, connected, presence,
    messages: messages[currentTextChannel] || [], allMessages: messages,
    currentTextChannel, currentVoiceChannel, voicePeers, music, musicError,
    joinTextChannel, sendMessage, joinVoice, leaveVoice, sendSignal, onSignal,
    pauseMusic, resumeMusic, stopMusic,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}
