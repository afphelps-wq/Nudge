/**
 * Edit Reminder: one reminder in the same card as Review, plus Save changes,
 * Mark as not done (when done) and Delete.
 */
import { useCanGoBack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PillButton } from '@/components/pill';
import { ReminderCard } from '@/components/reminder-card';
import { ScreenHeader } from '@/components/screen-header';
import { Colors, Fonts } from '@/constants/theme';
import { draftToPatch, isDraftValid, reminderToDraft } from '@/lib/reminders';
import { useNow, useNudge } from '@/lib/store';
import type { Reminder } from '@/lib/types';

const DELETE_MESSAGE = "This can't be undone.";

/** Back to wherever the user came from, or to Capture when a link opened this screen directly. */
function useClose(): () => void {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return () => {
    if (canGoBack) {
      router.back();
    } else {
      router.replace('/');
    }
  };
}

function NotFound() {
  const close = useClose();
  return (
    <View style={styles.notFound}>
      <Text style={styles.notFoundText}>This nudge no longer exists.</Text>
      <PillButton label="Back" size="medium" onPress={close} style={styles.centered} />
    </View>
  );
}

interface EditFormProps {
  reminder: Reminder;
  /** Called just before this screen deletes its own reminder. */
  onDeleted: () => void;
}

function EditForm({ reminder, onDeleted }: EditFormProps) {
  const close = useClose();
  const now = useNow();
  const { settings, updateReminder, removeReminder, toggleDone, rescheduleAllNotifications } =
    useNudge();
  // Prefilled once; from then on the card edits this draft, not the stored reminder.
  const [draft, setDraft] = useState(() => reminderToDraft(reminder, new Date()));

  const saveChanges = () => {
    updateReminder(reminder.id, draftToPatch(draft, reminder, new Date(), settings));
    void rescheduleAllNotifications();
    close();
  };

  const confirmDelete = () => {
    Alert.alert('Delete this nudge?', DELETE_MESSAGE, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          onDeleted();
          removeReminder(reminder.id);
          void rescheduleAllNotifications();
          close();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.bodyContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets>
      <ReminderCard draft={draft} now={now} settings={settings} onChange={setDraft} />

      <View style={styles.buttons}>
        <PillButton
          label="Save changes"
          disabled={!isDraftValid(draft, now)}
          onPress={saveChanges}
        />
        {reminder.status === 'done' ? (
          <PillButton
            label="Mark as not done"
            variant="outlined"
            onPress={() => toggleDone(reminder.id)}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={confirmDelete}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

export default function EditReminderScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const { reminders } = useNudge();
  // The id can come from a link: accept a single string and look it up, nothing more.
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const reminder = typeof id === 'string' ? reminders.find((item) => item.id === id) : undefined;
  // After Delete the reminder is gone while this screen is still sliding away;
  // show nothing then, rather than the "no longer exists" message.
  const [deletedHere, setDeletedHere] = useState(false);

  let content = null;
  if (reminder) {
    content = (
      <EditForm key={reminder.id} reminder={reminder} onDeleted={() => setDeletedHere(true)} />
    );
  } else if (!deletedHere) {
    content = <NotFound />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title="Edit nudge" />
      {content}
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
  buttons: {
    gap: 12,
  },
  deleteButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  deleteLabel: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: Colors.coral,
  },
  pressed: {
    opacity: 0.6,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  notFoundText: {
    fontFamily: Fonts.regular,
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  centered: {
    alignSelf: 'center',
  },
});
