import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:80?transport=tcp',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

export function useWebRTC() {
  const { currentVoiceChannel, voicePeers, sendSignal, onSignal, leaveVoice, socket } = useSocket();
  const mySocketId = socket?.id || null;

  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [error, setError] = useState(null);

  const pcsRef = useRef({});
  const localStreamRef = useRef(null);
  const pendingIceRef = useRef({});
  const makingOfferRef = useRef({});
  const ignoreOfferRef = useRef({});
  const micEnabledRef = useRef(true);
  const camEnabledRef = useRef(true);
  const audioElsRef = useRef({});
  const myIdRef = useRef(null);
  myIdRef.current = mySocketId;

  const attachRemoteAudio = useCallback((socketId, stream) => {
    let el = audioElsRef.current[socketId];
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute('playsinline', 'true');
      el.volume = 1;
      document.body.appendChild(el);
      audioElsRef.current[socketId] = el;
    }
    if (el.srcObject !== stream) el.srcObject = stream;
    const tryPlay = () => {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    };
    tryPlay();
    stream.getAudioTracks().forEach((t) => { t.enabled = true; t.onunmute = tryPlay; });
  }, []);

  const cleanupPeer = useCallback((socketId) => {
    const pc = pcsRef.current[socketId];
    if (pc) {
      try { pc.close(); } catch { /* ignore */ }
      delete pcsRef.current[socketId];
    }
    const el = audioElsRef.current[socketId];
    if (el) {
      try { el.pause(); el.srcObject = null; el.remove(); } catch { /* ignore */ }
      delete audioElsRef.current[socketId];
    }
    delete pendingIceRef.current[socketId];
    delete makingOfferRef.current[socketId];
    delete ignoreOfferRef.current[socketId];
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  const stopLocal = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    Object.keys(pcsRef.current).forEach(cleanupPeer);
    pcsRef.current = {};
    Object.values(audioElsRef.current).forEach((el) => {
      try { el.pause(); el.srcObject = null; el.remove(); } catch { /* ignore */ }
    });
    audioElsRef.current = {};
    pendingIceRef.current = {};
    setRemoteStreams({});
  }, [cleanupPeer]);

  const flushIce = useCallback(async (socketId, pc) => {
    const queued = pendingIceRef.current[socketId] || [];
    pendingIceRef.current[socketId] = [];
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
  }, []);

  const getOrCreatePC = useCallback((socketId) => {
    if (pcsRef.current[socketId]) return pcsRef.current[socketId];
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcsRef.current[socketId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemoteStreams((prev) => {
        const existing = prev[socketId];
        if (existing) {
          event.track && !existing.getTracks().includes(event.track) && existing.addTrack(event.track);
          return { ...prev, [socketId]: existing };
        }
        return { ...prev, [socketId]: stream };
      });
      attachRemoteAudio(socketId, stream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(socketId, { type: 'candidate', candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch { /* ignore */ }
      }
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        if (pc.connectionState === 'closed') cleanupPeer(socketId);
      }
    };

    pc.onnegotiationneeded = async () => {
      const mine = myIdRef.current;
      // Only the higher socket id starts offers (prevents glare)
      if (!mine || mine <= socketId) return;
      try {
        makingOfferRef.current[socketId] = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(socketId, { type: 'offer', sdp: pc.localDescription });
      } catch (err) {
        console.error('negotiationneeded', err);
      } finally {
        makingOfferRef.current[socketId] = false;
      }
    };

    return pc;
  }, [sendSignal, cleanupPeer, attachRemoteAudio]);

  // Get camera + mic as soon as we join a call/channel
  useEffect(() => {
    if (!currentVoiceChannel) {
      stopLocal();
      setMicEnabled(true);
      setCamEnabled(true);
      micEnabledRef.current = true;
      camEnabledRef.current = true;
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
      } catch (err) {
        console.warn('video+audio failed, trying audio only', err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          setCamEnabled(false);
          camEnabledRef.current = false;
          setError('Camera unavailable — audio only. Allow camera for video call.');
        } catch (err2) {
          console.error('getUserMedia error', err2);
          setError(err2.name === 'NotAllowedError'
            ? 'Allow microphone and camera to use video call.'
            : 'Could not access camera/microphone.');
          return;
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      if (!cancelled && !error) setError(null);
    })();
    return () => { cancelled = true; };
  }, [currentVoiceChannel, stopLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect to peers only after local media is ready
  useEffect(() => {
    if (!currentVoiceChannel || !localStream || !mySocketId) return;
    const peerIds = new Set(voicePeers.map((p) => p.socketId));
    Object.keys(pcsRef.current).forEach((id) => { if (!peerIds.has(id)) cleanupPeer(id); });
    voicePeers.forEach((peer) => {
      getOrCreatePC(peer.socketId);
    });
  }, [voicePeers, currentVoiceChannel, localStream, mySocketId, getOrCreatePC, cleanupPeer]);

  useEffect(() => {
    const unsub = onSignal(async ({ from, signal }) => {
      if (!signal || !from) return;
      const pc = getOrCreatePC(from);
      try {
        if (signal.type === 'offer') {
          const readyForOffer = pc.signalingState === 'stable' || pc.signalingState === 'have-local-offer';
          const offerCollision = makingOfferRef.current[from] || pc.signalingState !== 'stable';
          const polite = (myIdRef.current || '') < from;
          ignoreOfferRef.current[from] = !polite && offerCollision;
          if (ignoreOfferRef.current[from]) return;
          if (offerCollision && readyForOffer) {
            await pc.setLocalDescription({ type: 'rollback' });
          }
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushIce(from, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(from, { type: 'answer', sdp: pc.localDescription });
        } else if (signal.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            await flushIce(from, pc);
          }
        } else if (signal.type === 'candidate' && signal.candidate) {
          if (pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch { /* ignore */ }
          } else {
            pendingIceRef.current[from] = pendingIceRef.current[from] || [];
            pendingIceRef.current[from].push(signal.candidate);
          }
        }
      } catch (err) {
        console.error('signal handling error', err);
      }
    });
    return unsub;
  }, [onSignal, getOrCreatePC, sendSignal, flushIce]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micEnabledRef.current;
    stream.getAudioTracks().forEach((t) => { t.enabled = next; });
    micEnabledRef.current = next;
    setMicEnabled(next);
  }, []);

  const toggleCam = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    if (camEnabledRef.current) {
      stream.getVideoTracks().forEach((t) => { t.enabled = false; });
      camEnabledRef.current = false;
      setCamEnabled(false);
      return;
    }
    const existing = stream.getVideoTracks()[0];
    if (existing) {
      existing.enabled = true;
      camEnabledRef.current = true;
      setCamEnabled(true);
      setLocalStream(new MediaStream(stream.getTracks()));
      return;
    }
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      const videoTrack = camStream.getVideoTracks()[0];
      if (!videoTrack) return;
      stream.addTrack(videoTrack);
      Object.values(pcsRef.current).forEach((pc) => pc.addTrack(videoTrack, stream));
      camEnabledRef.current = true;
      setCamEnabled(true);
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch (err) {
      console.error('camera error', err);
      setError('Could not access camera.');
    }
  }, []);

  const hangUp = useCallback(() => { stopLocal(); leaveVoice(); }, [stopLocal, leaveVoice]);

  return {
    micEnabled,
    camEnabled,
    localStream,
    remoteStreams,
    error,
    toggleMic,
    toggleCam,
    hangUp,
    inCall: !!currentVoiceChannel,
  };
}
