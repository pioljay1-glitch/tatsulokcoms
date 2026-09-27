import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user, isAuthenticated, handleAuthError } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState([]);
  const [messages, setMessages] = useState({}); // channelId -> messages[]
  const [currentTextChannel, setCurrentTextChannel] = useState('general');
  const [currentVoiceChannel, setCurrentVoiceChannel] = useState(null);
  const [voicePeers, setVoicePeers] = useState([]);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
        setPresence([]);
        setVoicePeers([]);
        setCurrentVoiceChannel(null);
      }
      return;
    }

    const socket = io({
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('channel:join', currentTextChannel || 'general');
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err.message);
      if (err.message === 'Unauthorized') {
        handleAuthError({ status: 401 });
      }
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
      setVoicePeers((prev) => {
        if (prev.some((p) => p.socketId === peer.socketId)) return prev;
        return [...prev, peer];
      });
    });
    socket.on('voice:user-left', ({ socketId }) => {
      setVoicePeers((prev) => prev.filter((p) => p.socketId !== socketId));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const joinTextChannel = useCallback((channelId) => {
    setCurrentTextChannel(channelId);
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('channel:join', channelId);
      // Load history
      socket.emit('messages:history', { channelId, limit: 50 }, (res) => {
        if (res?.messages) {
          setMessages((prev) => ({ ...prev, [channelId]: res.messages }));
        }
      });
    }
  }, []);

  const sendMessage = useCallback((text) => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket?.connected) return reject(new Error('Not connected'));
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
  }, []);

  const leaveVoice = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('voice:leave');
    }
    setCurrentVoiceChannel(null);
    setVoicePeers([]);
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

  const value = {
    socket: socketRef.current,
    connected,
    presence,
    messages: messages[currentTextChannel] || [],
    allMessages: messages,
    currentTextChannel,
    currentVoiceChannel,
    voicePeers,
    joinTextChannel,
    sendMessage,
    joinVoice,
    leaveVoice,
    sendSignal,
    onSignal,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}
