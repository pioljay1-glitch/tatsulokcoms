import { useEffect, useRef, useState } from 'react';

function speak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve(false);
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const pick = voices.find((v) => /en[-_]?US/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
    if (pick) u.voice = pick;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    window.speechSynthesis.speak(u);
  });
}

function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.18;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.stop(ctx.currentTime + 0.36);
    return true;
  } catch {
    return false;
  }
}

function replyTo(input) {
  const t = (input || '').toLowerCase().trim();
  if (!t) return 'I am ChatAssistant. I can hear you. Say hello or type a message.';
  if (/hello|hi|hey|kumusta|musta/.test(t)) return 'Hello! This is ChatAssistant. If you can hear this, your speaker is working.';
  if (/hear|narinig|tunog|sound|speaker/.test(t)) return 'Yes. If you hear my voice, your device speaker is working.';
  if (/name|pangalan/.test(t)) return 'My name is ChatAssistant. I live in the ChatAssistant channel.';
  if (/test/.test(t)) return 'Speaker test. One. Two. Three. Can you hear me?';
  return `I heard you say: ${input}. Your microphone reached me. If you also hear this reply, audio is working both ways on this device.`;
}

export default function ChatAssistant({ userName }) {
  const [lines, setLines] = useState([
    { from: 'ChatAssistant', text: 'Hi. I am ChatAssistant. Tap Speak now so I can talk through your speaker.' },
  ]);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('Tap Speak now to test your speaker.');
  const recRef = useRef(null);

  useEffect(() => {
    if (window.speechSynthesis?.getVoices) window.speechSynthesis.getVoices();
  }, []);

  const addLine = (from, text) => {
    setLines((prev) => [...prev, { from, text }]);
  };

  const assistantTalk = async (text) => {
    addLine('ChatAssistant', text);
    playBeep();
    setStatus('Speaking…');
    await speak(text);
    setStatus('Ready.');
  };

  const handleSpeakNow = async () => {
    const name = userName || 'friend';
    await assistantTalk(`Hello ${name}. I am ChatAssistant. If you can hear this, your speaker works. Tap Listen and talk to me next.`);
  };

  const handleListen = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('Voice listen is not available on this browser. Type a message below instead.');
      assistantTalk('I cannot use speech recognition on this device. Type a message and I will still speak my reply.');
      return;
    }
    try {
      if (recRef.current) recRef.current.stop();
    } catch { /* ignore */ }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      setListening(true);
      setStatus('Listening… speak now.');
    };
    rec.onerror = () => {
      setListening(false);
      setStatus('Listen failed. Try again or type.');
    };
    rec.onend = () => setListening(false);
    rec.onresult = async (e) => {
      const heard = e.results?.[0]?.[0]?.transcript || '';
      addLine('You', heard);
      setStatus(`Heard: ${heard}`);
      await assistantTalk(replyTo(heard));
    };
    recRef.current = rec;
    rec.start();
  };

  const handleTyped = async (e) => {
    e.preventDefault();
    const form = e.target;
    const input = form.elements.assist.value.trim();
    if (!input) return;
    form.reset();
    addLine('You', input);
    await assistantTalk(replyTo(input));
  };

  return (
    <div className="assistant-panel">
      <div className="assistant-head">
        <strong>ChatAssistant</strong>
        <span>{status}</span>
      </div>
      <div className="assistant-log">
        {lines.map((l, i) => (
          <div key={i} className={l.from === 'You' ? 'assistant-you' : 'assistant-bot'}>
            <b>{l.from}:</b> {l.text}
          </div>
        ))}
      </div>
      <div className="assistant-actions">
        <button type="button" onClick={handleSpeakNow}>Speak now</button>
        <button type="button" className={listening ? '' : 'secondary'} onClick={handleListen}>
          {listening ? 'Listening…' : 'Listen to me'}
        </button>
      </div>
      <form className="assistant-form" onSubmit={handleTyped}>
        <input name="assist" type="text" placeholder="Type here if voice listen is not available" maxLength={500} />
        <button type="submit">Reply</button>
      </form>
    </div>
  );
}
