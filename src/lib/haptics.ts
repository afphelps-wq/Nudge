/**
 * Haptic feedback. Both functions are no-ops when haptics are turned off in
 * Settings, and both swallow errors (haptics are never worth a crash; iOS also
 * silently skips them in Low Power Mode or while dictation is active).
 */
import * as Haptics from 'expo-haptics';

let enabled = true;

/** Kept in sync with `settings.hapticsEnabled` by the store. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

/** Success buzz, played when reminders are saved. */
export function success(): void {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Light tick, played when a reminder is checked off. */
export function tick(): void {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
