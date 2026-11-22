/**
 * Phase 2: a safe wrapper around expo-speech-recognition.
 *
 * The package throws as soon as it is evaluated in a binary without its native
 * half (Expo Go), so it must never be imported at the top level of any file.
 * It is loaded here once, at module scope, behind two guards. In Expo Go
 * `speechAvailable` is false and the mic keeps its Phase 1 behaviour.
 */
import { isRunningInExpoGo, requireOptionalNativeModule } from 'expo';

type SpeechPackage = typeof import('expo-speech-recognition');
export type SpeechModule = SpeechPackage['ExpoSpeechRecognitionModule'];

export const isExpoGo = isRunningInExpoGo();

function loadSpeechModule(): SpeechModule | null {
  // Only evaluate the package when its native module is in this binary. This
  // has to run at module scope: Metro can only catch a throwing require there.
  if (isExpoGo || requireOptionalNativeModule('ExpoSpeechRecognition') == null) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('expo-speech-recognition') as SpeechPackage;
    return pkg.ExpoSpeechRecognitionModule ?? null;
  } catch {
    return null;
  }
}

/** The native speech module, or null when it is not available (Expo Go). */
export const speechModule: SpeechModule | null = loadSpeechModule();
export const speechAvailable = speechModule != null;

/** Recording stops by itself after this long. */
export const MAX_RECORDING_MS = 60_000;

/** Asks for speech-recognition and microphone access. Resolves false on denial or error. */
export async function requestSpeechPermission(mod: SpeechModule): Promise<boolean> {
  try {
    return (await mod.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Starts live recognition. Failures arrive as `error` events, but guard the call anyway. */
export function startRecognition(mod: SpeechModule): void {
  mod.start({
    lang: 'en-US',
    interimResults: true,
    continuous: true,
    addsPunctuation: true,
    maxAlternatives: 1,
    // Keep audio on the phone whenever the device can; otherwise Apple's
    // recognizer may use the network.
    requiresOnDeviceRecognition: mod.supportsOnDeviceRecognition(),
    volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
  });
}

/**
 * Combines the text recognised so far with a new result. iOS sends either the
 * whole transcript on every event or, after a pause, only the new segment, so
 * simply taking the latest result would lose earlier phrases.
 */
export function mergeTranscript(committed: string, incoming: string): string {
  const previous = committed.trim();
  const next = incoming.trim();
  if (!previous) return next;
  if (!next) return previous;
  if (next.toLowerCase().startsWith(previous.toLowerCase())) return next;
  return `${previous} ${next}`;
}

/** Hands the audio session back so other apps' audio, notification sounds and haptics resume. */
export function releaseAudioSession(mod: SpeechModule): void {
  try {
    mod.setAudioSessionActiveIOS(false, { notifyOthersOnDeactivation: true });
  } catch {
    // The session is still busy or was never activated; nothing to release.
  }
}
