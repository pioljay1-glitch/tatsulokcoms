import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useWebRTC() {
  const { currentVoiceChannel, voicePeers, sendSignal, onSignal, leaveVoice } = useSocket();
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [error, setError] = useState(null);

  const pcsRef = useRef({});
  const localStreamRef = useRef(null);
  const micEnabledRef = useRef(true);
  const camEnabledRef = useRef(false);

  const cleanupPeer = useCallback((socketId) => {
    const pc = pcsRef.current[socketId];
    if (pc) {
      try { pc.close(); } catch {}
      delete pcsRef.current[socketId];
    }
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
    setRemoteStreams({});
  }, [cleanupPeer]);

  const getOrCreatePC = useCallback((socketId, isInitiator) => {
    if (pcsRef.current[socketId]) return pcsRef.current[socketId];
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcsRef.current[socketId] = pc;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) setRemoteStreams((prev) => ({ ...prev, [socketId]: stream }));
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(socketId, { type: 'candidate', candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanupPeer(socketId);
    };
    if (isInitiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => sendSignal(socketId, { type: 'offer', sdp: pc.localDescription }))
        .catch((err) => console.error('createOffer error', err));
    }
    return pc;
  }, [sendSignal, cleanupPeer]);

  useEffect(() => {
    if (!currentVoiceChannel) {
      stopLocal();
      setMicEnabled(true);
      setCamEnabled(false);
      micEnabledRef.current = true;
      camEnabledRef.current = false;
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setError(null);
      } catch (err) {
        console.error('getUserMedia error', err);
        setError(err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow mic access to use voice.'
          : 'Could not access microphone.');
      }
    })();
    return () => { cancelled = true; };
  }, [currentVoiceChannel, stopLocal]);

  useEffect(() => {
    if (!currentVoiceChannel || !localStreamRef.current) return;
    const peerIds = new Set(voicePeers.map((p) => p.socketId));
    Object.keys(pcsRef.current).forEach((id) => { if (!peerIds.has(id)) cleanupPeer(id); });
    voicePeers.forEach((peer) => {
      if (!pcsRef.current[peer.socketId]) getOrCreatePC(peer.socketId, true);
    });
  }, [voicePeers, currentVoiceChannel, getOrCreatePC, cleanupPeer]);

  useEffect(() => {
    const unsub = onSignal(async ({ from, signal }) => {
      if (!signal || !from) return;
      try {
        if (signal.type === 'offer') {
          const pc = getOrCreatePC(from, false);
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(from, { type: 'answer', sdp: pc.localDescription });
        } else if (signal.type === 'answer') {
          const pc = pcsRef.current[from];
          if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.type === 'candidate') {
          const pc = pcsRef.current[from];
          if (pc && signal.candidate) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (err) {
        console.error('signal handling error', err);
      }
    });
    return unsub;
  }, [onSignal, getOrCreatePC, sendSignal]);

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
      stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
      Object.values(pcsRef.current).forEach((pc) => {
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === 'video') pc.removeTrack(sender);
        });
      });
      camEnabledRef.current = false;
      setCamEnabled(false);
      setLocalStream(new MediaStream(stream.getTracks()));
      return;
    }
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const videoTrack = camStream.getVideoTracks()[0];
      if (!videoTrack) return;
      stream.addTrack(videoTrack);
      Object.values(pcsRef.current).forEach((pc) => pc.addTrack(videoTrack, stream));
      Object.entries(pcsRef.current).forEach(async ([socketId, pc]) => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(socketId, { type: 'offer', sdp: pc.localDescription });
        } catch (e) { console.error(e); }
      });
      camEnabledRef.current = true;
      setCamEnabled(true);
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch (err) {
      console.error('camera error', err);
      setError('Could not access camera.');
    }
  }, [sendSignal]);

  const hangUp = useCallback(() => { stopLocal(); leaveVoice(); }, [stopLocal, leaveVoice]);

  return { micEnabled, camEnabled, localStream, remoteStreams, error, toggleMic, toggleCam, hangUp, inCall: !!currentVoiceChannel };
}
