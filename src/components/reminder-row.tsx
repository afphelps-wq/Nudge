/**
 * One row of the Reminders list: checkbox, title and subtitle on a tinted card.
 */
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Colors, Fonts } from '@/constants/theme';
import { isOverdue, reminderSubtitle } from '@/lib/reminders';
import type { Reminder, Settings } from '@/lib/types';

const DONE_OPACITY = 0.55;
const FADE_MS = 200;
const PRESSED_OPACITY = 0.7;

export interface ReminderRowProps {
  reminder: Reminder;
  /** The screen's clock (`useNow()`), so every row agrees on what "overdue" means. */
  now: Date;
  settings: Settings;
  /** Checkbox tapped. The screen calls `toggleDone(id)` and plays the tick haptic. */
  onToggle: (id: string) => void;
  /** Row tapped outside the checkbox. The screen opens `/reminder/[id]`. */
  onPress: (id: string) => void;
}

/** One reminder in the Reminders list. */
export function ReminderRow({ reminder, now, settings, onToggle, onPress }: ReminderRowProps) {
  const done = reminder.status === 'done';
  const overdue = isOverdue(reminder, now);
  const subtitle = reminderSubtitle(reminder, now, settings);

  // A row that mounts already done starts faded; only a later check-off animates.
  const opacity = useSharedValue(done ? DONE_OPACITY : 1);
  useEffect(() => {
    opacity.set(withTiming(done ? DONE_OPACITY : 1, { duration: FADE_MS }));
  }, [done, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const openReminder = () => onPress(reminder.id);

  return (
    // The done fade is applied once, here, to the whole row (the title only adds the strikethrough).
    <Animated.View style={fadeStyle}>
      <Pressable
        // Not one VoiceOver element: iOS would then hide the checkbox inside it.
        // The checkbox and the text block below are the two elements instead.
        accessible={false}
        accessibilityRole="button"
        onPress={openReminder}
        style={({ pressed }) => [
          styles.card,
          reminder.type === 'task' ? styles.task : styles.event,
          overdue && styles.overdue,
          pressed && styles.pressed,
        ]}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Mark ${reminder.text} as done`}
          accessibilityState={{ checked: done }}
          hitSlop={8}
          onPress={() => onToggle(reminder.id)}
          style={[styles.checkbox, done && styles.checkboxDone]}>
          {done ? (
            <SymbolView
              name="checkmark"
              size={14}
              tintColor={Colors.surface}
              resizeMode="scaleAspectFit"
            />
          ) : null}
        </Pressable>
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${reminder.text}, ${subtitle}`}
          onAccessibilityTap={openReminder}
          style={styles.body}>
          <Text style={[styles.title, done && styles.titleDone]}>{reminder.text}</Text>
          <Text style={[styles.subtitle, overdue && styles.subtitleOverdue]}>{subtitle}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 20,
  },
  task: {
    backgroundColor: Colors.peach,
  },
  event: {
    backgroundColor: Colors.mint,
  },
  // The 4px border replaces 4px of left padding, so checkboxes line up across rows.
  overdue: {
    borderLeftWidth: 4,
    borderLeftColor: Colors.coral,
    paddingLeft: 12,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: Colors.primary,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.bold,
    fontSize: 17,
    color: Colors.text,
  },
  titleDone: {
    textDecorationLine: 'line-through',
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  subtitleOverdue: {
    color: Colors.coral,
  },
});
