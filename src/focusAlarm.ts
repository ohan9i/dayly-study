// The focus clock's finish signal: a short tone, a vibration and, where the
// reader has allowed it, a system notice. The preference is shared by the clock
// on the planner and the switch on the settings screen.
import { useEffect, useState } from 'react';

const storageKey = 'dayly.focus-alarm';
const listeners = new Set<(on: boolean) => void>();

function readPreference() {
  try {
    return localStorage.getItem(storageKey) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readPreference();
let audio: AudioContext | null = null;

export function setAlarmEnabled(next: boolean) {
  if (next === enabled) return;
  enabled = next;
  try {
    localStorage.setItem(storageKey, next ? 'on' : 'off');
  } catch {
    // The choice still holds for this visit without browser storage.
  }
  listeners.forEach((listener) => listener(next));
}

export function useAlarmEnabled() {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    listeners.add(setOn);
    setOn(enabled);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return [on, setAlarmEnabled] as const;
}

/**
 * Called from the gesture that starts the clock. Browsers only allow sound and
 * permission prompts from a real press, so the groundwork is laid here and the
 * finish itself only has to play.
 */
export function prepareAlarm() {
  if (!enabled) return;
  try {
    if ('Notification' in window && Notification.permission === 'default')
      void Notification.requestPermission();
  } catch {
    // A refused prompt leaves the tone and the vibration.
  }
  try {
    const Audio =
      window.AudioContext ||
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    audio = audio || new Audio();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function playTone() {
  if (!audio || audio.state === 'closed') return;
  try {
    // Two soft notes, quiet enough for a library.
    [0, 0.4].forEach((offset) => {
      const start = audio!.currentTime + offset;
      const tone = audio!.createOscillator();
      const level = audio!.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(880, start);
      level.gain.setValueAtTime(0.0001, start);
      level.gain.exponentialRampToValueAtTime(0.16, start + 0.04);
      level.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      tone.connect(level).connect(audio!.destination);
      tone.start(start);
      tone.stop(start + 0.34);
    });
  } catch {
    // A blocked audio context must never stop the clock itself.
  }
}

export function soundAlarm(message: string) {
  if (!enabled) return;
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch {
    // Vibration is unavailable on most desktops.
  }
  try {
    if ('Notification' in window && Notification.permission === 'granted')
      new Notification('Dayly', { body: message, tag: 'dayly-focus-clock' });
  } catch {
    // A notification the browser rejects still leaves the tone.
  }
  playTone();
}
