// Lightweight Web Audio cues for search results. Uses synthesized tones so we
// don't have to ship audio assets, and so playback is reliable on mobile where
// AudioContext gets unlocked by the same user gesture (tap/scan) that triggers
// the search.

let ctx = null;

const getContext = () => {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
    return ctx;
};

const playTone = (audio, {frequency, duration, startAt, type = 'sine', gain = 0.18}) => {
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startAt);
    env.gain.setValueAtTime(0, startAt);
    env.gain.linearRampToValueAtTime(gain, startAt + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(env).connect(audio.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
};

export const playFoundSound = () => {
    const audio = getContext();
    if (!audio) return;
    const now = audio.currentTime;
    // Pleasant ascending two-note chirp (E5 → A5).
    playTone(audio, {frequency: 659.25, duration: 0.12, startAt: now});
    playTone(audio, {frequency: 880.0,  duration: 0.18, startAt: now + 0.11});
};

export const playNotFoundSound = () => {
    const audio = getContext();
    if (!audio) return;
    const now = audio.currentTime;
    // Lower descending two-note buzz (A3 → E3) using a square wave for a
    // distinctly "negative" timbre.
    playTone(audio, {frequency: 220.0, duration: 0.18, startAt: now,        type: 'square', gain: 0.12});
    playTone(audio, {frequency: 164.81, duration: 0.28, startAt: now + 0.16, type: 'square', gain: 0.12});
};
