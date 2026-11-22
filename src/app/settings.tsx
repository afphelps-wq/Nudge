/**
 * Settings. Every change is saved immediately and the notification schedule is rebuilt.
 */
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pill, PillButton } from '@/components/pill';
import { ScreenHeader } from '@/components/screen-header';
import { Colors, Fonts } from '@/constants/theme';
import { hhmmToDate, toHHmm } from '@/lib/format';
import { cancelAllNotifications, requestPermission, sendTestNudge } from '@/lib/notifications';
import { useNudge } from '@/lib/store';
import type {
  DefaultNagStartHours,
  EventLeadMinutes,
  NagIntervalMinutes,
  Settings,
} from '@/lib/types';

interface Option<T> {
  label: string;
  value: T;
}

const EVENT_LEAD_OPTIONS: Option<EventLeadMinutes>[] = [
  { label: 'At start', value: 0 },
  { label: '10 min', value: 10 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hr', value: 60 },
];

const NAG_INTERVAL_OPTIONS: Option<NagIntervalMinutes>[] = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hr', value: 60 },
  { label: '2 hrs', value: 120 },
];

const NAG_START_OPTIONS: Option<DefaultNagStartHours>[] = [
  { label: '1 hr', value: 1 },
  { label: '2 hrs', value: 2 },
  { label: '3 hrs', value: 3 },
  { label: '6 hrs', value: 6 },
];

interface PillRowProps<T> {
  options: Option<T>[];
  selected: T;
  onSelect: (value: T) => void;
}

/** A wrapping row of single-choice pills. */
function PillRow<T extends number>({ options, selected, onSelect }: PillRowProps<T>) {
  return (
    <View style={styles.pillRow}>
      {options.map((option) => (
        <Pill
          key={option.value}
          label={option.label}
          selected={option.value === selected}
          backgroundColor={Colors.background}
          onPress={() => onSelect(option.value)}
        />
      ))}
    </View>
  );
}

interface TimeRowProps {
  label: string;
  /** "HH:mm" */
  value: string;
  onChange: (value: string) => void;
}

/** A label with a compact time picker, bound to an "HH:mm" string. */
function TimeRow({ label, value, onChange }: TimeRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <DateTimePicker
        value={hhmmToDate(value)}
        mode="time"
        display="compact"
        themeVariant="light"
        accentColor={Colors.primary}
        onValueChange={(_event, date) => {
          const next = toHHmm(date);
          // The picker reports every wheel movement; only real changes are saved.
          if (next !== value) onChange(next);
        }}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { settings, updateSettings, rescheduleAllNotifications, clearAllReminders } = useNudge();
  const [sendingTest, setSendingTest] = useState(false);
  const sendingTestRef = useRef(false);

  // Save, then rebuild the schedule (reschedules are queued and merged, so
  // a burst of changes is fine).
  const change = (patch: Partial<Settings>) => {
    updateSettings(patch);
    void rescheduleAllNotifications();
  };

  const sendTest = async () => {
    if (sendingTestRef.current) return;
    sendingTestRef.current = true;
    setSendingTest(true);
    try {
      if (!settings.hasAskedNotificationPermission) {
        await requestPermission();
        updateSettings({ hasAskedNotificationPermission: true });
        // Finish this rebuild first, so it cannot cancel the test nudge.
        await rescheduleAllNotifications();
      }
      const scheduled = await sendTestNudge();
      if (!scheduled) {
        Alert.alert(
          'Notifications are off',
          'Turn on notifications for Nudge in the Settings app to get nudges.'
        );
      }
    } catch (error) {
      console.warn('[nudge] could not send the test nudge', error);
    }
    sendingTestRef.current = false;
    setSendingTest(false);
  };

  const confirmDeleteAll = () => {
    Alert.alert('Delete all nudges?', 'This removes every reminder from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          clearAllReminders();
          // cancelAllNotifications never rejects. Settings are kept.
          void cancelAllNotifications();
        },
      },
    ]);
  };

  const { quietHours } = settings;

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title="Settings" />
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Quiet hours</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Pause task nags overnight</Text>
            <Switch
              accessibilityLabel="Pause task nags overnight"
              value={quietHours.enabled}
              onValueChange={(enabled) => change({ quietHours: { ...quietHours, enabled } })}
              trackColor={{ true: Colors.primary }}
            />
          </View>
          {quietHours.enabled ? (
            <>
              <TimeRow
                label="From"
                value={quietHours.start}
                onChange={(start) => change({ quietHours: { ...quietHours, start } })}
              />
              <TimeRow
                label="Until"
                value={quietHours.end}
                onChange={(end) => change({ quietHours: { ...quietHours, end } })}
              />
            </>
          ) : null}
          <Text style={styles.caption}>
            Task nags pause during these hours. Events still notify.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Event heads-up</Text>
          <PillRow
            options={EVENT_LEAD_OPTIONS}
            selected={settings.eventLeadMinutes}
            onSelect={(eventLeadMinutes) => change({ eventLeadMinutes })}
          />
          <Text style={styles.caption}>{"How early you're notified before an event."}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Nag me every</Text>
          <PillRow
            options={NAG_INTERVAL_OPTIONS}
            selected={settings.nagIntervalMinutes}
            onSelect={(nagIntervalMinutes) => change({ nagIntervalMinutes })}
          />
          <Text style={styles.caption}>How often unfinished tasks remind you.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Start nagging (tasks with a deadline)</Text>
          <PillRow
            options={NAG_START_OPTIONS}
            selected={settings.defaultNagStartHours}
            onSelect={(defaultNagStartHours) => change({ defaultNagStartHours })}
          />
          <Text style={styles.caption}>
            Default for new tasks. You can change it on each task.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Haptics</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Vibrate on save and check-off</Text>
            <Switch
              accessibilityLabel="Vibrate on save and check-off"
              value={settings.hapticsEnabled}
              onValueChange={(hapticsEnabled) => change({ hapticsEnabled })}
              trackColor={{ true: Colors.primary }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Try it</Text>
          <PillButton
            label="Send a test nudge"
            variant="outlined"
            disabled={sendingTest}
            onPress={() => {
              // `sendTest` handles its own errors and never rejects.
              void sendTest();
            }}
          />
          <Text style={styles.caption}>Arrives in 5 seconds. Lock your phone to see it.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Danger zone</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={confirmDeleteAll}
            style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}>
            <Text style={styles.dangerLabel}>Delete all nudges</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>Nudge v1.0 · Everything stays on this phone.</Text>
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
    gap: 16,
  },
  card: {
    padding: 18,
    borderRadius: 24,
    gap: 12,
    backgroundColor: Colors.surface,
  },
  sectionLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 16,
    color: Colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontFamily: Fonts.semibold,
    fontSize: 16,
    color: Colors.text,
  },
  caption: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dangerButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  dangerLabel: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: Colors.coral,
  },
  pressed: {
    opacity: 0.6,
  },
  footer: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
