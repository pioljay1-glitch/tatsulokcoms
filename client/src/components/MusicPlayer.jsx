import { useEffect, useRef, useState } from 'react';

/**
 * Music-only player. Auto-plays when /play is sent (user gesture from Send).
 * Uses YouTube IFrame API for reliable play/pause control.
 */
export default function MusicPlayer({ music, onPause, onResume, onStop }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [apiReady, setApiReady] = useState(!!window.YT?.Player);

  // Load YouTube IFrame API once
  useEffect(() => {
    if (window.YT?.Player) {
      setApiReady(true);
      return;
    }
    const existing = document.getElementById('yt-iframe-api');
    if (existing) {
      const check = setInterval(() => {
        if (window.YT?.Player) {
          setApiReady(true);
          clearInterval(check);
        }
      }, 100);
      return () => clearInterval(check);
    }
    const tag = document.createElement('script');
    tag.id = 'yt-iframe-api';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      setApiReady(true);
    };
  }, []);

  // Create / update player when music changes
  useEffect(() => {
    if (!music?.videoId || !apiReady || !containerRef.current) return;

    const videoId = music.videoId;

    const create = () => {
      // Clear previous
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      containerRef.current.innerHTML = '';
      const mount = document.createElement('div');
      mount.id = `yt-player-${Date.now()}`;
      containerRef.current.appendChild(mount);

      playerRef.current = new window.YT.Player(mount.id, {
        height: '72',
        width: '100%',
        videoId,
        playerVars: {
          autoplay: music.playing ? 1 : 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          disablekb: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            setReady(true);
            if (music.playing) {
              try {
                e.target.unMute();
                e.target.setVolume(100);
                e.target.playVideo();
              } catch { /* ignore */ }
            }
          },
          onStateChange: (e) => {
            // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0
            if (e.data === 0) {
              // ended — optional stop
            }
          },
          onError: () => {
            // embed blocked — user can use Open sound
          },
        },
      });
    };

    create();

    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music?.videoId, apiReady]);

  // React to pause / resume without recreating player
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !ready || typeof p.playVideo !== 'function') return;
    try {
      if (music?.playing) {
        p.unMute();
        p.playVideo();
      } else {
        p.pauseVideo();
      }
    } catch { /* ignore */ }
  }, [music?.playing, ready]);

  if (!music?.videoId) return null;

  const thumb = `https://i.ytimg.com/vi/${music.videoId}/mqdefault.jpg`;
  const watchUrl = `https://www.youtube.com/watch?v=${music.videoId}`;

  return (
    <div className="music-panel">
      <div className="music-audio-bar">
        <img className="music-thumb" src={thumb} alt="" />
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
          <a className="music-open" href={watchUrl} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        </div>
      </div>
      <div className="music-audio-strip" ref={containerRef} />
    </div>
  );
}
