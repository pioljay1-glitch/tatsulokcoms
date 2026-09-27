import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { avatarSrc } from '../utils/avatar';
import ProfileModal from '../components/ProfileModal';

const TEXT_CHANNELS = [
  { id: 'general', name: 'general' },
  { id: 'random', name: 'random' },
];
const VOICE_CHANNELS = [
  { id: 'Lobby', name: 'Lobby' },
  { id: 'Gaming', name: 'Gaming' },
];

export default function App() {
  const { user, logout } = useAuth();
  const {
    connected, presence, messages, currentTextChannel, currentVoiceChannel,
    voicePeers, joinTextChannel, sendMessage, joinVoice, leaveVoice,
  } = useSocket();

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    joinTextChannel(currentTextChannel || 'general');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await sendMessage(t);
      setText('');
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    if (currentVoiceChannel) leaveVoice();
    await logout();
  };

  return (
    <div className={'app-layout'}>
      <aside className={'sidebar'}>
        <div className={'sidebar-header'}>TATSULOKComs</div>
        <div className={'channel-list'}>
          <div className={'channel-section'}>
            <div className={'channel-section-title'}>Text channels</div>
            {TEXT_CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={currentTextChannel === ch.id ? 'channel-item active' : 'channel-item'}
                onClick={() => joinTextChannel(ch.id)}
              >
                # {ch.name}
              </button>
            ))}
          </div>
          <div className={'channel-section'}>
            <div className={'channel-section-title'}>Voice channels</div>
            {VOICE_CHANNELS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={currentVoiceChannel === ch.id ? 'channel-item active' : 'channel-item'}
                onClick={() => {
                  if (currentVoiceChannel === ch.id) leaveVoice();
                  else joinVoice(ch.id);
                }}
              >
                Voice: {ch.name}
                {currentVoiceChannel === ch.id ? ' (connected)' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className={'user-bar'}>
          <div className={'avatar'}>
            <img src={avatarSrc(user)} alt="" />
          </div>
          <div className={'user-info'}>
            <div className={'name'}>{user?.displayName}</div>
            <div className={'status'}>{connected ? 'Online' : 'Connecting...'}</div>
          </div>
          <div className={'user-actions'}>
            <button type="button" title="Settings" onClick={() => setShowProfile(true)}>Settings</button>
            <button type="button" title="Log out" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </aside>
      <main className={'main-area'}>
        <div className={'channel-header'}>
          <span>#</span> {currentTextChannel}
        </div>
        <div className={'messages'}>
          {messages.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No messages yet. Say hello!</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={'message'}>
              <div className={'avatar'}>
                <img src={avatarSrc({ displayName: m.displayName, avatarUrl: m.avatarUrl })} alt="" />
              </div>
              <div>
                <div className={'meta'}>
                  <strong>{m.displayName}</strong>
                  <span>@{m.username}</span>
                  {' · '}
                  {new Date(m.timestamp).toLocaleTimeString()}
                </div>
                <div className={'body'}>{m.text}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        {currentVoiceChannel && (
          <div className={'voice-bar'}>
            <span>
              Connected to <strong>{currentVoiceChannel}</strong>
              {voicePeers.length > 0 ? ` · ${voicePeers.length} other(s)` : ''}
            </span>
            <button type="button" onClick={leaveVoice}>Disconnect</button>
          </div>
        )}
        <div className={'message-input-bar'}>
          <form onSubmit={handleSend}>
            <input
              type="text"
              placeholder={`Message #${currentTextChannel}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              disabled={!connected}
            />
            <button type="submit" disabled={!connected || !text.trim() || sending}>Send</button>
          </form>
        </div>
      </main>
      <aside className={'member-sidebar'}>
        <h3>Online — {presence.length}</h3>
        {presence.map((p) => (
          <div key={p.userId} className={'member-item'}>
            <span className={'dot'} />
            <div className={'avatar'} style={{ width: 24, height: 24, fontSize: '0.65rem' }}>
              <img src={avatarSrc(p)} alt="" />
            </div>
            <span>{p.displayName}</span>
          </div>
        ))}
        {presence.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0 0.35rem' }}>No one online yet</p>
        )}
      </aside>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}
