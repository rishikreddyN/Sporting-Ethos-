import { API_BASE } from '../config';

/**
 * Robust Audio + Voice System
 * Fixes: voices async loading, SpeechSynthesis stalling, AudioContext suspension
 */

let audioCtx: AudioContext | null = null;
let _unlocked = false;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

// ─── Unlock (call inside a click handler) ────────────────────────────────────

export async function unlockAudio(): Promise<void> {
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    // Play a 0-length silent buffer to permanently unlock Web Audio
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);

    // Prime SpeechSynthesis — required by browser autoplay policy
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      primer.rate = 10;
      window.speechSynthesis.speak(primer);
    }

    _unlocked = true;
    console.log('[Audio] ✅ Unlocked — Web Audio + SpeechSynthesis primed.');
  } catch (e) {
    console.error('[Audio] Unlock failed:', e);
  }
}

// ─── Speech queue ─────────────────────────────────────────────────────────────

interface QueueItem {
  text: string;
  lang: string;
}

let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeAudio: HTMLAudioElement | null = null;
const queue: QueueItem[] = [];
let busy = false;

function playGoogleTTS(text: string, langPrefix: string, onDone: () => void) {
  try {
    const url = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}&lang=${langPrefix}`;
    console.log('[Audio] Fetching backend proxied TTS audio from:', url);
    const audio = new Audio(url);
    activeAudio = audio;

    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null;
      onDone();
    };
    audio.onerror = (e) => {
      console.warn('[Audio] Proxied TTS audio error:', e);
      if (activeAudio === audio) activeAudio = null;
      onDone();
    };

    audio.play().catch(err => {
      console.warn('[Audio] Proxied TTS audio play() failed:', err);
      if (activeAudio === audio) activeAudio = null;
      onDone();
    });
  } catch (err) {
    console.warn('[Audio] Failed to instantiate Audio for proxied TTS:', err);
    onDone();
  }
}

function drainQueue() {
  if (busy || queue.length === 0) return;
  const item = queue.shift()!;
  busy = true;
  console.log('[Audio] Speaking:', item.text, 'in lang:', item.lang);

  const langPrefix = item.lang.split('-')[0].toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  console.log('[Audio] Available voices count:', voices.length);

  const matchedVoice = 
    voices.find(v => v.lang.toLowerCase() === item.lang.toLowerCase()) ||
    voices.find(v => v.lang.toLowerCase().startsWith(langPrefix));

  if (matchedVoice) {
    console.log('[Audio] Using matched OS voice:', matchedVoice.name, 'for lang:', matchedVoice.lang);
    const utter = new SpeechSynthesisUtterance(item.text);
    activeUtterance = utter;
    utter.voice = matchedVoice;
    utter.lang = item.lang;
    utter.rate = 0.9;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    utter.onend = () => {
      if (activeUtterance === utter) activeUtterance = null;
      busy = false;
      setTimeout(drainQueue, 300);
    };
    utter.onerror = (e) => {
      console.warn('[Audio] Speech error:', e);
      if (activeUtterance === utter) activeUtterance = null;
      busy = false;
      setTimeout(drainQueue, 300);
    };

    window.speechSynthesis.speak(utter);
  } else if (langPrefix !== 'en') {
    console.log(`[Audio] No OS voice for ${item.lang}. Using high-quality Google TTS audio fallback for ${langPrefix}...`);
    playGoogleTTS(item.text, langPrefix, () => {
      busy = false;
      setTimeout(drainQueue, 300);
    });
  } else {
    const utter = new SpeechSynthesisUtterance(item.text);
    activeUtterance = utter;
    utter.lang = item.lang;
    utter.rate = 0.9;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    utter.onend = () => {
      if (activeUtterance === utter) activeUtterance = null;
      busy = false;
      setTimeout(drainQueue, 300);
    };
    utter.onerror = (e) => {
      console.warn('[Audio] Speech error:', e);
      if (activeUtterance === utter) activeUtterance = null;
      busy = false;
      setTimeout(drainQueue, 300);
    };

    window.speechSynthesis.speak(utter);
  }
}

export function cancelSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  console.log('[Audio] Canceling all speech and clearing queue.');
  queue.length = 0;
  busy = false;
  activeUtterance = null;
}

export function speakEmergency(text: string, lang: string = 'en-US') {
  if (!('speechSynthesis' in window)) return;
  console.log('[Audio] EMERGENCY OVERRIDE TRIGGERED. Speaking:', text, 'in lang:', lang);
  cancelSpeech();
  // Wait 150ms to allow the browser to fully cancel current speech before scheduling the new one
  setTimeout(() => {
    speak(text, lang);
  }, 150);
}

export function speak(text: string, lang: string = 'en-US') {
  if (!('speechSynthesis' in window)) {
    console.warn('[Audio] SpeechSynthesis not available.');
    return;
  }
  // Always attempt unlock if not already unlocked
  if (!_unlocked) {
    unlockAudio().catch(() => {});
  }
  console.log('[Audio] Queuing speech:', text, 'in lang:', lang);
  queue.push({ text, lang });

  // If voices aren't loaded yet, wait for them
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      drainQueue();
    };
  } else {
    drainQueue();
  }
}

// ─── Chime (C5 → E5) ─────────────────────────────────────────────────────────

export function playChime() {
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;

    [[523.25, 0], [659.25, 0.13]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + delay);
      gain.gain.setValueAtTime(0.13, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.5);
    });
    console.log('[Audio] Chime played.');
  } catch (e) {
    console.warn('[Audio] Chime failed:', e);
  }
}

// ─── Alert (escalation) ───────────────────────────────────────────────────────

export function playAlert() {
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;

    [0, 0.22].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, t + delay);
      filt.type = 'bandpass';
      filt.frequency.setValueAtTime(880, t + delay);
      gain.gain.setValueAtTime(0.09, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.18);
      osc.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.18);
    });
    console.log('[Audio] Alert played.');
  } catch (e) {
    console.warn('[Audio] Alert failed:', e);
  }
}

if (typeof window !== 'undefined') {
  const autoUnlock = () => {
    unlockAudio().catch(() => {});
    window.removeEventListener('click', autoUnlock);
    window.removeEventListener('touchstart', autoUnlock);
    window.removeEventListener('keydown', autoUnlock);
  };
  window.addEventListener('click', autoUnlock);
  window.addEventListener('touchstart', autoUnlock);
  window.addEventListener('keydown', autoUnlock);
}
