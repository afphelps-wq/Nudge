/**
 * Review (modal): the captured text parsed into editable cards, then Save.
 * Nothing is stored until Save is tapped; Cancel or a swipe down discards it all.
 */
import { useCanGoBack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PillButton } from '@/components/pill';
import { ReminderCard } from '@/components/reminder-card';
import { Colors, Fonts } from '@/constants/theme';
import { success } from '@/lib/haptics';
import { requestPermission } from '@/lib/notifications';
import { cleanCaptureText, parseCapture } from '@/lib/parse';
import { draftToReminder, emptyTaskDraft, isDraftValid } from '@/lib/reminders';
import { useNow, useNudge } from '@/lib/store';
import type { DraftReminder } from '@/lib/types';

const INVALID_HINT = 'Pick a time or tap Not sure on each card';

export default function ReviewScreen() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const params = useLocalSearchParams<{ text?: string | string[] }>();
  const now = useNow();
  const {
    settings,
    addReminders,
    updateSettings,
    rescheduleAllNotifications,
    showToast,
    setCaptureText,
  } = useNudge();

  // Parsed once, when the screen opens. The param can come from a link, so it
  // is cleaned and length-limited before it is used.
  const [cards, setCards] = useState<DraftReminder[]>(() => {
    const text = cleanCaptureText(params.text);
    const openedAt = new Date();
    const drafts = parseCapture(text, openedAt, settings);
    return drafts.length > 0 ? drafts : [emptyTaskDraft(text, openedAt)];
  });
  const [saving, setSaving] = useState(false);
  // The state above only drives the button's look; this guards against a second
  // tap landing before React has re-rendered (or while the permission prompt is up).
  const savingRef = useRef(false);

  const allValid = cards.every((card) => isDraftValid(card, now));
  const canRemove = cards.length > 1;

  const close = () => {
    if (canGoBack) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const changeCard = (next: DraftReminder) => {
    setCards((current) => current.map((card) => (card.key === next.key ? next : card)));
  };

  const removeCard = (key: string) => {
    setCards((current) =>
      current.length > 1 ? current.filter((card) => card.key !== key) : current
    );
  };

  const save = async () => {
    if (savingRef.current || !allValid) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const savedAt = new Date();
      const reminders = cards.map((card) => draftToReminder(card, savedAt, settings));
      // Saved first: whatever happens with the permission prompt, nothing is lost.
      addReminders(reminders);
      if (!settings.hasAskedNotificationPermission) {
        await requestPermission();
        updateSettings({ hasAskedNotificationPermission: true });
      }
      void rescheduleAllNotifications();
      success();
      setCaptureText('');
      showToast(reminders.length === 1 ? 'Saved ✓' : `Saved ${reminders.length} nudges ✓`);
      close();
    } catch (error) {
      console.warn('[nudge] could not save', error);
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* A page sheet starts below the status bar, so no top safe-area inset here. */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={close}
          style={({ pressed }) => [styles.headerSide, pressed && styles.pressed]}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>
          Review
        </Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets>
        {cards.map((card) => (
          <ReminderCard
            key={card.key}
            draft={card}
            now={now}
            settings={settings}
            onChange={changeCard}
            onRemove={canRemove ? () => removeCard(card.key) : undefined}
          />
        ))}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {allValid ? null : <Text style={styles.hint}>{INVALID_HINT}</Text>}
        <PillButton
          label={cards.length === 1 ? 'Save' : `Save all (${cards.length})`}
          disabled={!allValid || saving}
          onPress={() => {
            // `save` handles its own errors and never rejects.
            void save();
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    marginTop: 8,
    paddingHorizontal: 20,
  },
  // Both sides share a width so the title stays centred.
  headerSide: {
    width: 76,
    justifyContent: 'center',
  },
  cancel: {
    fontFamily: Fonts.semibold,
    fontSize: 17,
    color: Colors.primary,
  },
  title: {
    fontFamily: Fonts.extrabold,
    fontSize: 20,
    color: Colors.text,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 20,
    gap: 14,
  },
  footer: {
    padding: 20,
    gap: 12,
  },
  hint: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
