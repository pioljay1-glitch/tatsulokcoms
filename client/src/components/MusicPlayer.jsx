/**
 * In-app music player — audio plays inside TATSULOKComs (no external tab).
 */
export default function MusicPlayer({ music, onPause, onResume, onStop }) {
  if (!music?.videoId) return null;

  const thumb = `https://i.ytimg.com/vi/${music.videoId}/hqdefault.jpg`;

  // youtube-nocookie + autoplay; CSP now allows this domain
  const embedSrc = music.playing
    ? `https://www.youtube-nocookie.com/embed/${music.videoId}?autoplay=1&mute=0&playsinline=1&controls=1&rel=0&modestbranding=1&fs=0`
    : `https://www.youtube-nocookie.com/embed/${music.videoId}?autoplay=0&playsinline=1&controls=1&rel=0&modestbranding=1&fs=0`;

  return (
    <div className="music-panel">
      <div className="music-audio-bar">
        <img
          className="music-thumb"
          src={thumb}
          alt=""
          onError={(e) => {
            e.currentTarget.src = `https://i.ytimg.com/vi/${music.videoId}/default.jpg`;
          }}
        />
        <div className="music-meta">
          <div className="music-title">{music.playing ? 'Now playing' : 'Paused'}</div>
          <div className="music-track">{music.title}</div>
          <div className="music-by">requested by {music.requestedBy}</div>
        </div>
        <div className="music-controls">
          {music.playing ? (
            <button type="button" className="secondary" onClick={onPause}>Pause</button>
          ) : (
            <button type="button" className="secondary" onClick={onResume}>Resume</button>
          )}
          <button type="button" className="danger" onClick={onStop}>Stop</button>
        </div>
      </div>
      <div className="music-audio-strip">
        <iframe
          key={`${music.videoId}-${music.playing ? 'on' : 'off'}`}
          title="music"
          src={embedSrc}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <p className="music-hint">Kung walang tunog: i-off ang silent switch, tapos pindutin ang ▶ sa player sa itaas.</p>
    </div>
  );
}
