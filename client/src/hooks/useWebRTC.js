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
  const { currentVoiceChannel, voicePeers, sendSignal, onSignal, leaveVoice, socketId } = useSocket();

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
  myIdRef.current = socketId;

  const attachRemoteAudio = useCallback((peerId, stream) => {
    let el = audioElsRef.current[peerId];
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute('playsinline', 'true');
      el.volume = 1;
      document.body.appendChild(el);
      audioElsRef.current[peerId] = el;
    }
    if (el.srcObject !== stream) el.srcObject = stream;
    const tryPlay = () => {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    };
    tryPlay();
    stream.getAudioTracks().forEach((t) => { t.enabled = true; t.onunmute = tryPlay; });
  }, []);

  const cleanupPeer = useCallback((peerId) => {
    const pc = pcsRef.current[peerId];
    if (pc) {
      try { pc.close(); } catch { /* ignore */ }
      delete pcsRef.current[peerId];
    }
    const el = audioElsRef.current[peerId];
    if (el) {
      try { el.pause(); el.srcObject = null; el.remove(); } catch { /* ignore */ }
      delete audioElsRef.current[peerId];
    }
    delete pendingIceRef.current[peerId];
    delete makingOfferRef.current[peerId];
    delete ignoreOfferRef.current[peerId];
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
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

  const flushIce = useCallback(async (peerId, pc) => {
    const queued = pendingIceRef.current[peerId] || [];
    pendingIceRef.current[peerId] = [];
    for (const c of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
  }, []);

  const getOrCreatePC = useCallback((peerId) => {
    if (pcsRef.current[peerId]) return pcsRef.current[peerId];
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcsRef.current[peerId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemoteStreams((prev) => {
        const existing = prev[peerId];
        if (existing) {
          if (event.track && !existing.getTracks().includes(event.track)) existing.addTrack(event.track);
          return { ...prev, [peerId]: existing };
        }
        return { ...prev, [peerId]: stream };
      });
      attachRemoteAudio(peerId, stream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch { /* ignore */ }
      }
      if (pc.connectionState === 'closed') cleanupPeer(peerId);
    };

    pc.onnegotiationneeded = async () => {
      const mine = myIdRef.current;
      if (!mine || mine <= peerId) return;
      try {
        makingOfferRef.current[peerId] = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(peerId, { type: 'offer', sdp: pc.localDescription });
      } catch (err) {
        console.error('negotiationneeded', err);
      } finally {
        makingOfferRef.current[peerId] = false;
      }
    };

    return pc;
  }, [sendSignal, cleanupPeer, attachRemoteAudio]);

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
    })();
    return () => { cancelled = true; };
  }, [currentVoiceChannel, stopLocal]);

  useEffect(() => {
    if (!currentVoiceChannel || !localStream || !socketId) return;
    const peerIds = new Set(voicePeers.map((p) => p.socketId));
    Object.keys(pcsRef.current).forEach((id) => { if (!peerIds.has(id)) cleanupPeer(id); });
    voicePeers.forEach((peer) => {
      getOrCreatePC(peer.socketId);
    });
  }, [voicePeers, currentVoiceChannel, localStream, socketId, getOrCreatePC, cleanupPeer]);

  useEffect(() => {
    const unsub = onSignal(async ({ from, signal }) => {
      if (!signal || !from) return;
      const pc = getOrCreatePC(from);
      try {
        if (signal.type === 'offer') {
          const offerCollision = makingOfferRef.current[from] || pc.signalingState !== 'stable';
          const polite = (myIdRef.current || '') < from;
          ignoreOfferRef.current[from] = !polite && offerCollision;
          if (ignoreOfferRef.current[from]) return;
          if (offerCollision && pc.signalingState !== 'stable') {
            try { await pc.setLocalDescription({ type: 'rollback' }); } catch { /* ignore */ }
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
