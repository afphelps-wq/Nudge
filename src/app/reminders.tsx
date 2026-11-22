/**
 * Reminders: "To do" (tasks) and "Coming up" (events).
 */
import { useCanGoBack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PillButton } from '@/components/pill';
import { ReminderRow } from '@/components/reminder-row';
import { ScreenHeader } from '@/components/screen-header';
import { Colors, Fonts } from '@/constants/theme';
import { tick } from '@/lib/haptics';
import { getPermissionState, type PermissionState } from '@/lib/notifications';
import { buildSections } from '@/lib/reminders';
import { useNow, useNudge } from '@/lib/store';

const NOTIFICATIONS_OFF = "Notifications are off, so Nudge can't remind you.";

export default function RemindersScreen() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const now = useNow();
  const { reminders, settings, toggleDone, runMaintenance } = useNudge();
  const [permission, setPermission] = useState<PermissionState>('undetermined');

  useFocusEffect(
    useCallback(() => {
      // Bring auto-completions up to date every time the list is shown.
      runMaintenance();

      let focused = true;
      const refreshPermission = () => {
        // getPermissionState never rejects.
        void getPermissionState().then((state) => {
          if (focused) setPermission(state);
        });
      };
      refreshPermission();
      // Coming back from the iOS Settings app does not refocus the screen, so
      // also look again when the app returns to the foreground.
      const subscription = AppState.addEventListener('change', (status) => {
        if (status === 'active') refreshPermission();
      });

      return () => {
        focused = false;
        subscription.remove();
      };
    }, [runMaintenance])
  );

  const { todo, comingUp } = buildSections(reminders, now);
  const nothingAtAll = todo.length === 0 && comingUp.length === 0;

  const toggle = (id: string) => {
    toggleDone(id);
    tick();
  };

  const openReminder = (id: string) => {
    router.push({ pathname: '/reminder/[id]', params: { id } });
  };

  const openSystemSettings = () => {
    Linking.openSettings().catch((error: unknown) => {
      console.warn('[nudge] could not open Settings', error);
    });
  };

  const addANudge = () => {
    if (canGoBack) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title="Your nudges" />
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {permission === 'denied' ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{NOTIFICATIONS_OFF}</Text>
            <PillButton
              label="Open Settings"
              size="medium"
              variant="outlined"
              onPress={openSystemSettings}
            />
          </View>
        ) : null}

        <Text accessibilityRole="header" style={styles.heading}>
          To do
        </Text>
        {todo.length === 0 ? (
          <Text style={styles.empty}>Nothing to do. Enjoy it 🌿</Text>
        ) : (
          todo.map((reminder) => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              now={now}
              settings={settings}
              onToggle={toggle}
              onPress={openReminder}
            />
          ))
        )}

        <Text accessibilityRole="header" style={styles.heading}>
          Coming up
        </Text>
        {comingUp.length === 0 ? (
          <Text style={styles.empty}>No upcoming events</Text>
        ) : (
          comingUp.map((reminder) => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              now={now}
              settings={settings}
              onToggle={toggle}
              onPress={openReminder}
            />
          ))
        )}

        {nothingAtAll ? (
          <PillButton
            label="Add a nudge"
            size="medium"
            onPress={addANudge}
            style={styles.addButton}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 20,
    gap: 10,
  },
  banner: {
    padding: 14,
    borderRadius: 18,
    gap: 10,
    backgroundColor: Colors.coralTint,
  },
  bannerText: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    color: Colors.text,
  },
  heading: {
    marginTop: 8,
    fontFamily: Fonts.extrabold,
    fontSize: 18,
    color: Colors.text,
  },
  empty: {
    fontFamily: Fonts.regular,
    fontSize: 15,
    color: Colors.textSecondary,
  },
  addButton: {
    alignSelf: 'center',
    marginTop: 16,
  },
});
