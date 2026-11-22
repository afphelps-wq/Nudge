/**
 * Capture (home): greeting, the always-visible text box, Next, and the big mic button.
 */
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { MicButton } from '@/components/mic-button';
import { PillButton } from '@/components/pill';
import { Toast } from '@/components/toast';
import { Colors, Fonts } from '@/constants/theme';
import { encodeCaptureParam, MAX_CAPTURE_LENGTH } from '@/lib/parse';
import { activeTaskCount } from '@/lib/reminders';
import { useNow, useNudge } from '@/lib/store';

const DICTATION_HINT = 'Tap 🎤 on your keyboard to dictate';
const GREETING_REFRESH_MS = 60_000;

/** "Good morning" 5:00–11:59, "Good afternoon" 12:00–16:59, "Good evening" otherwise. */
function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function CaptureScreen() {
  const router = useRouter();
  const now = useNow(GREETING_REFRESH_MS);
  const { reminders, captureText, setCaptureText, showToast } = useNudge();
  const inputRef = useRef<TextInputInstance | null>(null);

  const hasText = captureText.trim().length > 0;

  // The text box is left as it is: Review clears it after a successful Save,
  // so cancelling Review brings the user back to what they typed.
  const goToReview = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    Keyboard.dismiss();
    router.push({ pathname: '/review', params: { text: encodeCaptureParam(trimmed) } });
  };

  // Phase 1 / Expo Go: open the keyboard, whose own mic key does the dictation.
  const focusForDictation = () => {
    inputRef.current?.focus();
    showToast(DICTATION_HINT);
  };

  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={[styles.blob, styles.blobPeach]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobMint]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobLavender]} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.topBar}>
            <IconButton
              symbol="gearshape"
              accessibilityLabel="Settings"
              onPress={() => router.push('/settings')}
            />
            <IconButton
              symbol="list.bullet"
              accessibilityLabel="Your nudges"
              badgeCount={activeTaskCount(reminders)}
              onPress={() => router.push('/reminders')}
            />
          </View>

          {/*
            Tapping the empty areas (here and around the mic) puts the keyboard away.
            They are not accessibility elements themselves, and they never wrap the
            text box, so focusing it cannot be mistaken for a tap on empty space.
          */}
          <Pressable accessible={false} onPress={Keyboard.dismiss} style={styles.greeting}>
            <Text style={styles.greetingTitle}>{greetingFor(now)}</Text>
            <Text style={styles.greetingSubtitle}>What do you need to remember?</Text>
          </Pressable>

          <View style={styles.card}>
            <TextInput
              ref={inputRef}
              value={captureText}
              onChangeText={setCaptureText}
              multiline
              maxLength={MAX_CAPTURE_LENGTH}
              placeholder="e.g. Dentist next Tuesday at 3"
              placeholderTextColor={Colors.textSecondary}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => goToReview(captureText)}
              accessibilityLabel="What do you need to remember?"
              style={styles.input}
            />
            {hasText ? (
              <PillButton
                label="Next →"
                size="medium"
                accessibilityLabel="Next"
                onPress={() => goToReview(captureText)}
                style={styles.nextButton}
              />
            ) : null}
          </View>

          <Pressable accessible={false} onPress={Keyboard.dismiss} style={styles.micArea}>
            <MicButton
              onFallbackPress={focusForDictation}
              onRecordingStart={() => setCaptureText('')}
              onTranscript={(text) => setCaptureText(text.slice(0, MAX_CAPTURE_LENGTH))}
              onFinished={goToReview}
              onMessage={showToast}
            />
          </Pressable>
        </View>
      </SafeAreaView>

      <Toast />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
    // The blobs hang off the edges of the screen on purpose.
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    opacity: 0.7,
  },
  blobPeach: {
    top: -80,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: Colors.peach,
  },
  blobMint: {
    bottom: -70,
    left: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: Colors.mint,
  },
  blobLavender: {
    top: 180,
    left: -60,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.lavender,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  greeting: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  greetingTitle: {
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    color: Colors.text,
  },
  greetingSubtitle: {
    marginTop: 4,
    fontFamily: Fonts.regular,
    fontSize: 17,
    color: Colors.textSecondary,
  },
  card: {
    marginHorizontal: 20,
    marginTop: 24,
    padding: 18,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    shadowColor: Colors.text,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  input: {
    minHeight: 96,
    padding: 0,
    fontFamily: Fonts.regular,
    fontSize: 18,
    color: Colors.text,
  },
  nextButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
  },
  micArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 32,
  },
});
