import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useWebRTC } from '../hooks/useWebRTC';
import { avatarSrc } from '../utils/avatar';
import ProfileModal from '../components/ProfileModal';
import MusicPlayer from '../components/MusicPlayer';

const TEXT_CHANNELS = [{ id: 'general', name: 'general' }, { id: 'random', name: 'random' }];
const VOICE_CHANNELS = [{ id: 'Lobby', name: 'Lobby' }, { id: 'Gaming', name: 'Gaming' }];

function RemoteMedia({ streams }) {
  const audioRefs = useRef({});
  useEffect(() => {
    Object.entries(streams).forEach(([id, stream]) => {
      let el = audioRefs.current[id];
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.playsInline = true;
        document.body.appendChild(el);
        audioRefs.current[id] = el;
      }
      if (el.srcObject !== stream) el.srcObject = stream;
    });
    Object.keys(audioRefs.current).forEach((id) => {
      if (!streams[id]) { audioRefs.current[id]?.remove(); delete audioRefs.current[id]; }
    });
  }, [streams]);
  useEffect(() => () => {
    Object.values(audioRefs.current).forEach((el) => el.remove());
    audioRefs.current = {};
  }, []);
  return (
    <div className="video-grid">
      {Object.entries(streams).map(([id, stream]) => {
        const hasVideo = stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
        if (!hasVideo) return null;
        return (
          <video key={id} autoPlay playsInline className="remote-video"
            ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }} />
        );
      })}
    </div>
  );
}

export default function App() {
  const { user, logout } = useAuth();
  const {
    connected, presence, messages, currentTextChannel, currentVoiceChannel, voicePeers,
    music, musicError, joinTextChannel, sendMessage, joinVoice,
    pauseMusic, resumeMusic, stopMusic,
    incomingCall, outgoingCall, callError,
    startCall, acceptCall, declineCall, endCall,
  } = useSocket();
  const { micEnabled, camEnabled, localStream, remoteStreams, error: mediaError, toggleMic, toggleCam, hangUp, inCall } = useWebRTC();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const messagesEndRef = useRef(null);
  const localVideoRef = useRef(null);

  useEffect(() => { joinTextChannel(currentTextChannel || 'general'); }, []); // eslint-disable-line
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream, camEnabled]);

  const handleSend = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try { await sendMessage(t); setText(''); } catch (err) { console.error(err); }
    finally { setSending(false); }
  };

  const handleLogout = async () => {
    if (currentVoiceChannel) hangUp();
    await logout();
  };

  const handleHangUp = () => {
    endCall();
    hangUp();
  };

  const isCallRoom = currentVoiceChannel && String(currentVoiceChannel).startsWith('call-');

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">TATSULOKComs</div>
        <div className="channel-list">
          <div className="channel-section">
            <div className="channel-section-title">Text channels</div>
            {TEXT_CHANNELS.map((ch) => (
              <button key={ch.id} type="button"
                className={currentTextChannel === ch.id ? 'channel-item active' : 'channel-item'}
                onClick={() => joinTextChannel(ch.id)}># {ch.name}</button>
            ))}
          </div>
          <div className="channel-section">
            <div className="channel-section-title">Voice channels</div>
            {VOICE_CHANNELS.map((ch) => (
              <button key={ch.id} type="button"
                className={currentVoiceChannel === ch.id ? 'channel-item active' : 'channel-item'}
                onClick={() => { if (currentVoiceChannel === ch.id) handleHangUp(); else joinVoice(ch.id); }}>
                Voice: {ch.name}{currentVoiceChannel === ch.id ? ' (connected)' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="user-bar">
          <div className="avatar"><img src={avatarSrc(user)} alt="" /></div>
          <div className="user-info">
            <div className="name">{user?.displayName}</div>
            <div className="status">{connected ? 'Online' : 'Connecting...'}</div>
          </div>
          <div className="user-actions">
            <button type="button" onClick={() => setShowProfile(true)}>Settings</button>
            <button type="button" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <div className="channel-header"><span>#</span> {currentTextChannel}</div>
        <div className="messages">
          {messages.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Paste a YouTube link to play music in-app. Use Call on online users for 1:1 calls.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className="message">
              <div className="avatar"><img src={avatarSrc({ displayName: m.displayName, avatarUrl: m.avatarUrl })} alt="" /></div>
              <div>
                <div className="meta">
                  <strong>{m.displayName}</strong> <span>@{m.username}</span>
                  {' · '}{new Date(m.timestamp).toLocaleTimeString()}
                </div>
                <div className="body">{m.text}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {inCall && (
          <div className="media-area">
            <RemoteMedia streams={remoteStreams} />
            {camEnabled && localStream && (
              <video ref={localVideoRef} autoPlay muted playsInline className="local-video" />
            )}
          </div>
        )}

        <MusicPlayer music={music} onPause={pauseMusic} onResume={resumeMusic} onStop={stopMusic} />
        {musicError && <div className="error-banner music-error">{musicError}</div>}
        {callError && <div className="error-banner music-error">{callError}</div>}

        {inCall && (
          <div className="voice-bar">
            <span>
              {isCallRoom ? 'In call' : <>Connected to <strong>{currentVoiceChannel}</strong></>}
              {voicePeers.length > 0 ? ` · ${voicePeers.length} other(s)` : ''}
              {mediaError ? ` · ${mediaError}` : ''}
            </span>
            <div className="voice-controls">
              <button type="button" className={micEnabled ? 'secondary' : 'danger'} onClick={toggleMic}>
                {micEnabled ? 'Mic On' : 'Mic Off'}
              </button>
              <button type="button" className={camEnabled ? '' : 'secondary'} onClick={toggleCam}>
                {camEnabled ? 'Cam On' : 'Cam Off'}
              </button>
              <button type="button" className="danger" onClick={handleHangUp}>
                {isCallRoom ? 'End Call' : 'Disconnect'}
              </button>
            </div>
          </div>
        )}

        {outgoingCall && (
          <div className="call-status-bar">Calling… <button type="button" className="danger" onClick={endCall}>Cancel</button></div>
        )}

        <div className="message-input-bar">
          <form onSubmit={handleSend}>
            <input type="text" placeholder={`Message #${currentTextChannel}  ·  paste YouTube link to play`}
              value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} disabled={!connected} />
            <button type="submit" disabled={!connected || !text.trim() || sending}>Send</button>
          </form>
        </div>
      </main>

      <aside className="member-sidebar">
        <h3>Online — {presence.length}</h3>
        {presence.map((p) => (
          <div key={p.userId} className="member-item">
            <span className="dot" />
            <div className="avatar" style={{ width: 24, height: 24, fontSize: '0.65rem' }}>
              <img src={avatarSrc(p)} alt="" />
            </div>
            <span className="member-name">{p.displayName}</span>
            {p.userId !== user?.id && (
              <button
                type="button"
                className="call-btn"
                title="Call"
                disabled={!!incomingCall || !!outgoingCall || inCall}
                onClick={() => startCall(p.userId)}
              >
                Call
              </button>
            )}
          </div>
        ))}
        <div style={{ marginTop: '1.5rem', padding: '0 0.35rem' }}>
          <h3>Music</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Paste YouTube link + Send — plays in-app.
            <br />/pause /resume /stop
          </p>
        </div>
      </aside>

      {incomingCall && (
        <div className="call-modal-overlay">
          <div className="call-modal">
            <div className="call-modal-avatar">
              <img src={avatarSrc({ displayName: incomingCall.fromDisplayName, avatarUrl: incomingCall.fromAvatarUrl })} alt="" />
            </div>
            <h2>Incoming call</h2>
            <p>{incomingCall.fromDisplayName} is calling you</p>
            <div className="call-modal-actions">
              <button type="button" className="danger" onClick={declineCall}>Decline</button>
              <button type="button" onClick={acceptCall}>Accept</button>
            </div>
          </div>
        </div>
      )}

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}
