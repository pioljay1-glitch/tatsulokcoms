import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useWebRTC } from '../hooks/useWebRTC';
import { avatarSrc } from '../utils/avatar';
import ProfileModal from '../components/ProfileModal';
import MusicPlayer from '../components/MusicPlayer';

const TEXT_CHANNELS = [{ id: 'general', name: 'general' }, { id: 'random', name: 'random' }];
const VOICE_CHANNELS = [{ id: 'Lobby', name: 'Lobby' }, { id: 'Gaming', name: 'Gaming' }];

function RemoteTile({ stream }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }, [stream]);
  const hasVideo = stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
  return (
    <div className="call-tile">
      <video ref={videoRef} autoPlay playsInline className={hasVideo ? 'remote-video' : 'remote-video hidden-video'} />
      {!hasVideo && <div className="call-tile-fallback">Audio</div>}
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
    const el = localVideoRef.current;
    if (!el || !localStream) return;
    if (el.srcObject !== localStream) el.srcObject = localStream;
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
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
            <div className="channel-section-title">Voice / Video</div>
            {VOICE_CHANNELS.map((ch) => (
              <button key={ch.id} type="button"
                className={currentVoiceChannel === ch.id ? 'channel-item active' : 'channel-item'}
                onClick={() => { if (currentVoiceChannel === ch.id) handleHangUp(); else joinVoice(ch.id); }}>
                Video: {ch.name}{currentVoiceChannel === ch.id ? ' (in call)' : ''}
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
              Call a user or join Video: Lobby. Allow camera + mic so both of you can see and hear each other.
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
          <div className="media-area call-stage">
            {Object.entries(remoteStreams).map(([id, stream]) => (
              <RemoteTile key={id} stream={stream} />
            ))}
            {localStream && (
              <div className="call-tile local-tile">
                <video ref={localVideoRef} autoPlay muted playsInline className="local-video" />
                <span className="call-tile-label">You</span>
              </div>
            )}
            {Object.keys(remoteStreams).length === 0 && (
              <div className="call-waiting">Waiting for the other person…</div>
            )}
          </div>
        )}

        <MusicPlayer music={music} onPause={pauseMusic} onResume={resumeMusic} onStop={stopMusic} />
        {musicError && <div className="error-banner music-error">{musicError}</div>}
        {callError && <div className="error-banner music-error">{callError}</div>}

        {inCall && (
          <div className="voice-bar">
            <span>
              {isCallRoom ? 'Video call' : <>In <strong>{currentVoiceChannel}</strong></>}
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
                {isCallRoom ? 'End Call' : 'Leave'}
              </button>
            </div>
          </div>
        )}

        {outgoingCall && (
          <div className="call-status-bar">Calling… <button type="button" className="danger" onClick={endCall}>Cancel</button></div>
        )}

        <div className="message-input-bar">
          <form onSubmit={handleSend}>
            <input type="text" placeholder={`Message #${currentTextChannel}`}
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
                title="Video call"
                disabled={!!incomingCall || !!outgoingCall || inCall}
                onClick={() => startCall(p.userId)}
              >
                Call
              </button>
            )}
          </div>
        ))}
      </aside>

      {incomingCall && (
        <div className="call-modal-overlay">
          <div className="call-modal">
            <div className="call-modal-avatar">
              <img src={avatarSrc({ displayName: incomingCall.fromDisplayName, avatarUrl: incomingCall.fromAvatarUrl })} alt="" />
            </div>
            <h2>Incoming video call</h2>
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
