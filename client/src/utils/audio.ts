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

const queue: string[] = [];
let busy = false;

function drainQueue() {
  if (busy || queue.length === 0) return;
  const text = queue.shift()!;
  busy = true;
  console.log('[Audio] Speaking:', text);

  // Chrome stall fix
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.volume = 1.0;

  // Pick best English voice — voices list loads asynchronously in Chrome
  const voices = window.speechSynthesis.getVoices();
  console.log('[Audio] Available voices:', voices.length);
  const best =
    voices.find(v => v.name.includes('Google US English')) ||
    voices.find(v => v.lang === 'en-US' && !v.localService) ||
    voices.find(v => v.lang.startsWith('en')) ||
    null;
  if (best) {
    utter.voice = best;
    console.log('[Audio] Using voice:', best.name);
  }

  utter.onend = () => { busy = false; setTimeout(drainQueue, 300); };
  utter.onerror = (e) => {
    console.warn('[Audio] Speech error:', e);
    busy = false;
    setTimeout(drainQueue, 300);
  };

  window.speechSynthesis.speak(utter);
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) {
    console.warn('[Audio] SpeechSynthesis not available.');
    return;
  }
  if (!_unlocked) {
    console.warn('[Audio] Audio not unlocked yet — skipping speak()');
    return;
  }
  console.log('[Audio] Queuing speech:', text);
  queue.push(text);

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
