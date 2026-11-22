/**
 * The big mic button, its pulse rings and its label.
 *
 * Phase 1 (Expo Go): speech recognition is not available, so a tap just asks
 * the screen to focus the text box and show the dictation hint.
 * Phase 2 (development build): tap to start live speech-to-text, tap again to stop.
 */
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  clamp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Colors, Fonts } from '@/constants/theme';
import {
  MAX_RECORDING_MS,
  mergeTranscript,
  releaseAudioSession,
  requestSpeechPermission,
  speechModule,
  startRecognition,
} from '@/lib/speech';

const COULD_NOT_HEAR = "Couldn't hear that, try again or type it";
const MIC_ACCESS_OFF = 'Microphone access is off. Enable it in Settings';

const BUTTON_SIZE = 120;
const RING_INDEXES = [3, 2, 1] as const; // largest first, so smaller rings draw on top
const RING_ANIMATION_MS = 100;

export interface MicButtonProps {
  /** Speech is unavailable (Expo Go / Phase 1): focus the text box and show the dictation hint. */
  onFallbackPress: () => void;
  /** Recording just started: clear the text box. */
  onRecordingStart: () => void;
  /** Live transcript so far: put it in the text box. */
  onTranscript: (text: string) => void;
  /** Recording ended with a non-empty transcript (already trimmed): go to Review. */
  onFinished: (text: string) => void;
  /** Something to tell the user in a toast (permission off, couldn't hear). */
  onMessage: (message: string) => void;
}

interface PulseRingProps {
  index: number;
  /** Raw volume from the recognizer, roughly −2…10. */
  volume: SharedValue<number>;
}

/** One ring behind the button. Its scale follows the voice volume on the UI thread. */
function PulseRing({ index, volume }: PulseRingProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const normalizedVolume = clamp(volume.get(), 0, 10) / 10;
    return {
      transform: [
        {
          scale: withTiming(1 + 0.08 * index + 0.5 * normalizedVolume, {
            duration: RING_ANIMATION_MS,
          }),
        },
      ],
    };
  });
  return <Animated.View pointerEvents="none" style={[styles.ring, animatedStyle]} />;
}

export function MicButton({
  onFallbackPress,
  onRecordingStart,
  onTranscript,
  onFinished,
  onMessage,
}: MicButtonProps) {
  const [recording, setRecording] = useState(false);
  const volume = useSharedValue(0);

  // Session bookkeeping lives in refs: it changes from native event callbacks
  // and must never be stale, and none of it is rendered.
  const startingRef = useRef(false); // the permission prompt is in flight
  const sessionRef = useRef(false); // true from a successful tap until end/error
  const committedRef = useRef(''); // segments iOS has finalised
  const transcriptRef = useRef(''); // everything heard so far
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useEffectEvent((failed: boolean) => {
    // `end` can arrive more than once (a late timer, a double tap); only the first counts.
    if (!sessionRef.current) return;
    sessionRef.current = false;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    volume.set(0);
    if (speechModule) releaseAudioSession(speechModule);
    const text = transcriptRef.current.trim();
    if (failed || text.length === 0) {
      onMessage(COULD_NOT_HEAR);
    } else {
      onFinished(text);
    }
  });

  const handleResult = useEffectEvent((transcript: string | undefined, isFinal: boolean) => {
    // The last event of a session can carry no results at all.
    if (!sessionRef.current || !transcript) return;
    const merged = mergeTranscript(committedRef.current, transcript);
    if (isFinal) committedRef.current = merged;
    transcriptRef.current = merged;
    onTranscript(merged);
  });

  const handleError = useEffectEvent((code: string) => {
    // `aborted` is our own cancel. `no-speech` can follow stop() even when words
    // were recognised; in that case let the `end` event finish normally.
    if (code === 'aborted') return;
    if (code === 'no-speech' && transcriptRef.current.trim().length > 0) return;
    finish(true);
  });

  useEffect(() => {
    const mod = speechModule;
    if (!mod) return;
    const subscriptions = [
      mod.addListener('start', () => {
        // A stop() that raced ahead of start() would leave the recognizer running.
        if (!sessionRef.current) mod.abort();
      }),
      mod.addListener('result', (event) => {
        handleResult(event.results[0]?.transcript, event.isFinal);
      }),
      mod.addListener('volumechange', (event) => {
        volume.set(event.value);
      }),
      mod.addListener('error', (event) => {
        handleError(event.error);
      }),
      mod.addListener('end', () => {
        finish(false);
      }),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (sessionRef.current) {
        // Leaving the screen mid-recording: stop listening and give the audio session back.
        sessionRef.current = false;
        try {
          mod.abort();
        } catch {
          // Nothing left to cancel.
        }
        releaseAudioSession(mod);
      }
    };
  }, [volume]);

  // Capture stays mounted underneath Review, Settings and the list, so going to
  // another screen does not unmount this button. Without this, tapping "Next"
  // mid-recording would leave the microphone on and later reopen Review with
  // text that had already been saved.
  useFocusEffect(
    useCallback(() => {
      return () => {
        const mod = speechModule;
        if (!mod || !sessionRef.current) return;
        // Cleared first, so the `aborted` / `end` events that follow are ignored.
        sessionRef.current = false;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = null;
        setRecording(false);
        volume.set(0);
        try {
          mod.abort();
        } catch {
          // Nothing left to cancel.
        }
        releaseAudioSession(mod);
      };
    }, [volume])
  );

  const startSession = async (mod: NonNullable<typeof speechModule>) => {
    if (startingRef.current) return;
    startingRef.current = true;
    const granted = await requestSpeechPermission(mod);
    startingRef.current = false;
    if (!granted) {
      onMessage(MIC_ACCESS_OFF);
      return;
    }
    sessionRef.current = true;
    committedRef.current = '';
    transcriptRef.current = '';
    onRecordingStart();
    setRecording(true);
    timerRef.current = setTimeout(() => {
      try {
        mod.stop();
      } catch {
        // Already stopped.
      }
    }, MAX_RECORDING_MS);
    try {
      startRecognition(mod);
    } catch {
      // start() normally reports problems through the `error` event; this covers a throw.
      sessionRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      setRecording(false);
      onMessage(COULD_NOT_HEAR);
    }
  };

  const handlePress = () => {
    const mod = speechModule;
    if (!mod) {
      onFallbackPress();
      return;
    }
    if (sessionRef.current) {
      try {
        mod.stop();
      } catch {
        // Already stopped; the `end` event (or the next tap) recovers.
      }
      return;
    }
    // requestSpeechPermission and the body above never reject.
    void startSession(mod);
  };

  return (
    <View style={styles.container}>
      <View style={styles.buttonArea}>
        {recording
          ? RING_INDEXES.map((index) => <PulseRing key={index} index={index} volume={volume} />)
          : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Speak a reminder'}
          onPress={handlePress}
          style={({ pressed }) => [
            styles.button,
            recording ? styles.buttonRecording : styles.buttonIdle,
            pressed && styles.buttonPressed,
          ]}>
          <SymbolView
            name={recording ? 'stop.fill' : 'mic.fill'}
            size={44}
            tintColor={Colors.surface}
            resizeMode="scaleAspectFit"
          />
        </Pressable>
      </View>
      <Text style={styles.label}>{recording ? 'Listening… tap to stop' : 'Tap to speak'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  buttonArea: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: Colors.coral,
    opacity: 0.25,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIdle: {
    backgroundColor: Colors.primary,
  },
  buttonRecording: {
    backgroundColor: Colors.coral,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  label: {
    marginTop: 16,
    fontFamily: Fonts.semibold,
    fontSize: 15,
    color: Colors.textSecondary,
  },
});
