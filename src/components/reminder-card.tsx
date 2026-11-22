/**
 * The editable card shared by Review and Edit.
 *
 * Controlled: all reminder data lives in `draft`, and every edit goes through
 * one of the pure rules in `@/lib/reminders`. The card only keeps UI state:
 * which panels are open, the repeat it started with, and a frozen "now" for
 * the picker's minimum date.
 */
import { DateTimePicker, type DateTimePickerProps } from '@expo/ui/community/datetime-picker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pill, PillButton } from '@/components/pill';
import { Colors, Fonts } from '@/constants/theme';
import { intervalLabel, repeatLabel } from '@/lib/format';
import {
  getNagChoice,
  getRepeatChoice,
  nextFullHour,
  pickerValue,
  repeatForChoice,
  setDraftDueAt,
  setDraftNagChoice,
  setDraftNagStart,
  setDraftNotSure,
  setDraftRepeat,
  setDraftType,
  whenChipLabel,
  type NagChoice,
  type RepeatChoice,
} from '@/lib/reminders';
import type { DraftReminder, Repeat, Settings } from '@/lib/types';

export interface ReminderCardProps {
  draft: DraftReminder;
  /** Called with a new draft object on every edit (the card never mutates `draft`). */
  onChange: (next: DraftReminder) => void;
  /** When provided, the card shows the xmark remove button (Review, more than one card). */
  onRemove?: () => void;
  /** The screen's clock (`useNow()`). */
  now: Date;
  settings: Settings;
}

/** Both card pickers use this display; switch to 'inline' here for the calendar grid. */
const CARD_PICKER_DISPLAY: NonNullable<DateTimePickerProps['display']> = 'spinner';

const NOT_SURE_LABEL = "Not sure — nag me until it's done";

const REPEAT_OPTIONS: { choice: Exclude<RepeatChoice, 'custom'>; label: string }[] = [
  { choice: 'never', label: 'Never' },
  { choice: 'daily', label: 'Daily' },
  { choice: 'weekdays', label: 'Weekdays' },
  { choice: 'weekends', label: 'Weekends' },
  { choice: 'weekly', label: 'Weekly' },
];

const NAG_OPTIONS: { choice: Exclude<NagChoice, 'custom'>; label: string }[] = [
  { choice: 'now', label: 'Now' },
  { choice: 1, label: '1 hr before' },
  { choice: 3, label: '3 hrs before' },
  { choice: 6, label: '6 hrs before' },
];

function isValidDate(date: Date | null): date is Date {
  return date !== null && !Number.isNaN(date.getTime());
}

/** A copy of `date` with seconds and milliseconds zeroed: the pickers work in whole minutes. */
function toWholeMinute(date: Date): Date {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy;
}

interface InlinePickerProps {
  /** Must be a valid date inside the given bounds (the native picker throws on an invalid one). */
  value: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  /** The user moved the wheels; `date` is on a whole minute. */
  onPick: (date: Date) => void;
  onDone: () => void;
}

/** An inline date + time picker with a "Done" text button below it. */
function InlinePicker({ value, minimumDate, maximumDate, onPick, onDone }: InlinePickerProps) {
  return (
    <View style={styles.picker}>
      <DateTimePicker
        value={value}
        mode="datetime"
        display={CARD_PICKER_DISPLAY}
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        themeVariant="light"
        accentColor={Colors.primary}
        style={styles.pickerControl}
        onValueChange={(_event, date) => {
          if (isValidDate(date)) onPick(toWholeMinute(date));
        }}
      />
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={onDone}
        style={({ pressed }) => [styles.doneButton, pressed ? styles.pressed : null]}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

interface WhenPickerProps {
  draft: DraftReminder;
  now: Date;
  onPick: (date: Date) => void;
  /** "Done" was tapped; `displayed` is the value the picker was showing. */
  onDone: (displayed: Date) => void;
}

/** The picker under the When chip. Mounted only while it is open. */
function WhenPicker({ draft, now, onPick, onDone }: WhenPickerProps) {
  // Frozen when the picker opens: a minimum that followed the clock would
  // move the wheels under the user's finger.
  const [openedAt] = useState(() => toWholeMinute(new Date()));
  const minimumDate = draft.type === 'event' ? openedAt : undefined;

  // Clamped here because the native picker can show a clamped date without
  // reporting it, which would leave the draft out of step with the wheels.
  const wanted = pickerValue(draft, now);
  const valid = isValidDate(wanted) ? wanted : now;
  const value = toWholeMinute(
    minimumDate !== undefined && valid.getTime() < minimumDate.getTime() ? minimumDate : valid
  );

  return (
    <InlinePicker
      value={value}
      minimumDate={minimumDate}
      onPick={onPick}
      onDone={() => onDone(value)}
    />
  );
}

interface RepeatRowProps {
  draft: DraftReminder;
  /** The custom weekday set the card started with, or null. */
  customRepeat: Repeat;
  onChange: (next: DraftReminder) => void;
}

function RepeatRow({ draft, customRepeat, onChange }: RepeatRowProps) {
  const anchor = draft.dueAt ?? draft.pickerPreset;
  const selected = getRepeatChoice(draft.repeat, anchor);

  return (
    <View style={styles.pillRow}>
      {REPEAT_OPTIONS.map(({ choice, label }) => (
        <Pill
          key={choice}
          label={label}
          selected={selected === choice}
          onPress={() => onChange(setDraftRepeat(draft, repeatForChoice(choice, anchor)))}
        />
      ))}
      {customRepeat !== null ? (
        <Pill
          label={repeatLabel(customRepeat)}
          selected={selected === 'custom'}
          onPress={() => onChange(setDraftRepeat(draft, customRepeat))}
        />
      ) : null}
    </View>
  );
}

interface NagStartRowProps {
  draft: DraftReminder;
  /** The task's deadline (`draft.dueAt`, known to be a valid date). */
  deadline: Date;
  now: Date;
  settings: Settings;
  onChange: (next: DraftReminder) => void;
}

/** "Start reminding me". Mounted only for a task with a deadline. */
function NagStartRow({ draft, deadline, now, settings, onChange }: NagStartRowProps) {
  // Kept here rather than in the card so the custom picker closes by itself
  // when this row goes away (the card became an event or lost its deadline).
  const [customOpen, setCustomOpen] = useState(false);
  const selected = getNagChoice(draft, now);

  const start = isValidDate(draft.nagStartAt) ? draft.nagStartAt : now;
  const customValue = toWholeMinute(start.getTime() > deadline.getTime() ? deadline : start);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Start reminding me</Text>
      <View style={styles.pillRow}>
        {NAG_OPTIONS.map(({ choice, label }) => (
          <Pill
            key={choice}
            label={label}
            selected={selected === choice}
            onPress={() => {
              onChange(setDraftNagChoice(draft, choice, now));
              setCustomOpen(false);
            }}
          />
        ))}
        <Pill
          label="Custom"
          selected={selected === 'custom'}
          onPress={() => {
            Keyboard.dismiss();
            setCustomOpen((open) => !open);
          }}
        />
      </View>
      {customOpen ? (
        // Only a maximum: a minimum of "now" could end up after an overdue
        // deadline, and a reversed range crashes the native picker.
        <InlinePicker
          value={customValue}
          maximumDate={deadline}
          onPick={(date) => onChange(setDraftNagStart(draft, date, now))}
          onDone={() => setCustomOpen(false)}
        />
      ) : null}
      <Text style={styles.caption}>
        {`Nags every ${intervalLabel(settings.nagIntervalMinutes)} until you tap Done`}
      </Text>
    </View>
  );
}

/**
 * The editable card shared by Review and Edit. Controlled: all reminder data
 * lives in `draft`; the card only keeps UI state (which pickers are open).
 * Render it with `key={draft.key}`.
 */
export function ReminderCard({ draft, onChange, onRemove, now, settings }: ReminderCardProps) {
  const [whenOpen, setWhenOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  // The sixth Repeat pill offers the custom weekday set the card started with,
  // so it stays available after the user tries another pill.
  const [customRepeat] = useState<Repeat>(() =>
    getRepeatChoice(draft.repeat, draft.dueAt ?? draft.pickerPreset) === 'custom'
      ? draft.repeat
      : null
  );

  const isEvent = draft.type === 'event';
  const hasNoDeadline = !isEvent && draft.dueAt === null && !draft.needsTime;
  const deadline = !isEvent && isValidDate(draft.dueAt) ? draft.dueAt : null;

  const toggleType = () => {
    const nextType = isEvent ? 'task' : 'event';
    onChange(setDraftType(draft, nextType, now, settings));
    // Tasks have no repeat row. (The custom nag picker closes with its row.)
    if (nextType === 'task') setRepeatOpen(false);
  };

  const pressWhen = () => {
    // The picker opens below the chips, where the keyboard would cover it.
    Keyboard.dismiss();
    if (hasNoDeadline) {
      // "No deadline" has no time to show, so it becomes the next full hour
      // straight away and the picker opens on it.
      onChange(setDraftDueAt(draft, nextFullHour(now), now, settings));
      setWhenOpen(true);
    } else {
      setWhenOpen((open) => !open);
    }
  };

  const finishWhen = (displayed: Date) => {
    // Done confirms what the wheels show whenever that is not the draft's own
    // time: a preset the user agrees with (the wheels never move, so no change
    // event arrives), or an event time in the past, which the picker cannot
    // show because its minimum is "now".
    const showsDraftTime =
      isValidDate(draft.dueAt) && toWholeMinute(draft.dueAt).getTime() === displayed.getTime();
    if (draft.needsTime || !showsDraftTime) {
      onChange(setDraftDueAt(draft, displayed, now, settings));
    }
    setWhenOpen(false);
  };

  const pressRepeat = () => {
    Keyboard.dismiss();
    setRepeatOpen((open) => !open);
  };

  const pressNotSure = () => {
    onChange(setDraftNotSure(draft, now));
    setWhenOpen(false);
    setRepeatOpen(false);
  };

  return (
    <View style={[styles.card, isEvent ? styles.eventCard : styles.taskCard]}>
      <TextInput
        value={draft.text}
        onChangeText={(text) => onChange({ ...draft, text })}
        maxLength={120}
        placeholder="What is it?"
        placeholderTextColor={Colors.textSecondary}
        returnKeyType="done"
        accessibilityLabel="Title"
        style={[styles.title, onRemove ? styles.titleBesideRemove : null]}
      />

      <View style={styles.pillRow}>
        <Pill label={isEvent ? '📅 Event' : '✅ Task'} onPress={toggleType} />
        <Pill
          label={whenChipLabel(draft, now)}
          backgroundColor={hasNoDeadline ? Colors.surface : Colors.yellow}
          borderColor={draft.needsTime ? Colors.coral : undefined}
          textColor={draft.needsTime ? Colors.coral : undefined}
          onPress={pressWhen}
        />
        {isEvent ? (
          <Pill
            label={repeatLabel(draft.repeat)}
            backgroundColor={Colors.lavender}
            onPress={pressRepeat}
          />
        ) : null}
      </View>

      {whenOpen ? (
        <WhenPicker
          draft={draft}
          now={now}
          onPick={(date) => onChange(setDraftDueAt(draft, date, now, settings))}
          onDone={finishWhen}
        />
      ) : null}

      {draft.needsTime ? (
        <PillButton
          label={NOT_SURE_LABEL}
          variant="outlined"
          size="medium"
          onPress={pressNotSure}
          style={styles.notSure}
        />
      ) : null}

      {isEvent && repeatOpen ? (
        <RepeatRow draft={draft} customRepeat={customRepeat} onChange={onChange} />
      ) : null}

      {deadline !== null ? (
        <NagStartRow
          draft={draft}
          deadline={deadline}
          now={now}
          settings={settings}
          onChange={onChange}
        />
      ) : null}

      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove this nudge"
          hitSlop={10}
          onPress={onRemove}
          style={({ pressed }) => [styles.remove, pressed ? styles.pressed : null]}>
          <SymbolView
            name="xmark"
            size={14}
            tintColor={Colors.textSecondary}
            resizeMode="scaleAspectFit"
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  taskCard: {
    backgroundColor: Colors.peach,
  },
  eventCard: {
    backgroundColor: Colors.mint,
  },
  title: {
    fontFamily: Fonts.bold,
    fontSize: 19,
    color: Colors.text,
    padding: 0,
  },
  // Keeps long titles clear of the remove button in the corner.
  titleBesideRemove: {
    paddingRight: 32,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  picker: {
    gap: 4,
  },
  // The picker's width comes from this layout; its height is measured natively.
  pickerControl: {
    alignSelf: 'stretch',
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  doneText: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: Colors.primary,
  },
  // Full width, so the long label has the whole card to fit in.
  notSure: {
    alignSelf: 'stretch',
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  caption: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  remove: {
    position: 'absolute',
    top: 16,
    right: 12,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
