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
const queue: QueueItem[] = [];
let busy = false;

function drainQueue() {
  if (busy || queue.length === 0) return;
  const item = queue.shift()!;
  busy = true;
  console.log('[Audio] Speaking:', item.text, 'in lang:', item.lang);

  const utter = new SpeechSynthesisUtterance(item.text);
  activeUtterance = utter; // Prevent garbage collection bug in Chrome

  utter.lang = item.lang;
  utter.rate = 0.9; // Slightly slower for clearer pronunciation in translated languages
  utter.pitch = 1.0;
  utter.volume = 1.0;

  // Pick best voice for the target language
  const voices = window.speechSynthesis.getVoices();
  console.log('[Audio] Available voices:', voices.length);
  
  // Find a voice matching the target language code (e.g. 'hi-IN')
  let best = voices.find(v => v.lang.toLowerCase() === item.lang.toLowerCase());
  
  // Fallback to prefix matching (e.g. 'hi' for 'hi-IN')
  if (!best) {
    const langPrefix = item.lang.split('-')[0].toLowerCase();
    best = voices.find(v => v.lang.toLowerCase().startsWith(langPrefix));
  }
  
  // Graceful fallback to English if no voice is found for the selected language
  if (!best) {
    console.warn(`[Audio] No voice found for language ${item.lang}. Falling back to English.`);
    utter.lang = 'en-IN'; // Fallback language code
    best = 
      voices.find(v => v.lang === 'en-IN') ||
      voices.find(v => v.name.includes('Google US English')) ||
      voices.find(v => v.lang === 'en-US' && !v.localService) ||
      voices.find(v => v.lang.startsWith('en')) ||
      null;
  }

  if (best) {
    utter.voice = best;
    console.log('[Audio] Using voice:', best.name);
  }

  utter.onend = () => {
    if (activeUtterance === utter) {
      activeUtterance = null;
    }
    busy = false;
    setTimeout(drainQueue, 300);
  };
  utter.onerror = (e) => {
    console.warn('[Audio] Speech error:', e);
    if (activeUtterance === utter) {
      activeUtterance = null;
    }
    busy = false;
    setTimeout(drainQueue, 300);
  };

  window.speechSynthesis.speak(utter);
}

export function cancelSpeech() {
  if (!('speechSynthesis' in window)) return;
  console.log('[Audio] Canceling all speech and clearing queue.', activeUtterance ? 'Active speech was playing.' : '');
  queue.length = 0;
  window.speechSynthesis.cancel();
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
  if (!_unlocked) {
    console.warn('[Audio] Audio not unlocked yet — skipping speak()');
    return;
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
