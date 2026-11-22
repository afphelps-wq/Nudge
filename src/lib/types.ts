export type ReminderType = 'event' | 'task';

export type Repeat =
  | null
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }; // 0 = Sunday … 6 = Saturday (JS Date.getDay()), sorted, unique

export interface Reminder {
  id: string; // Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  text: string; // trimmed title, e.g. "Dentist", "Finish essay"
  type: ReminderType;
  /**
   * ISO string. Event: event time (required). Task: deadline, or null = no deadline.
   * Repeating events: the NEXT upcoming occurrence.
   */
  dueAt: string | null;
  /** ISO. Tasks: when nagging starts (required for tasks). Events: always null. */
  nagStartAt: string | null;
  /** Events only; always null for tasks. */
  repeat: Repeat;
  status: 'active' | 'done';
  /** ISO, set when status becomes 'done'. */
  completedAt: string | null;
  /** ISO. */
  createdAt: string;
}

/** Review/Edit only, never stored. */
export interface DraftReminder {
  key: string; // React key
  text: string;
  type: ReminderType;
  dueAt: Date | null;
  needsTime: boolean; // true = user must pick a time or tap Not sure
  pickerPreset: Date; // initial value for the date picker when dueAt is null
  nagStartAt: Date | null;
  repeat: Repeat;
}

export type EventLeadMinutes = 0 | 10 | 15 | 30 | 60;
export type NagIntervalMinutes = 15 | 30 | 60 | 120;
export type DefaultNagStartHours = 1 | 2 | 3 | 6;

export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:mm" 24h
  end: string; // "HH:mm" 24h
}

export interface Settings {
  quietHours: QuietHours;
  eventLeadMinutes: EventLeadMinutes;
  nagIntervalMinutes: NagIntervalMinutes;
  defaultNagStartHours: DefaultNagStartHours;
  hapticsEnabled: boolean;
  hasAskedNotificationPermission: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  eventLeadMinutes: 30,
  nagIntervalMinutes: 60,
  defaultNagStartHours: 3,
  hapticsEnabled: true,
  hasAskedNotificationPermission: false,
};
