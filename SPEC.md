# App Specification
<!-- Template created with CLAUDE for 15-113 -->

> **For the building agent:** this spec is meant to be complete. Every behavior, rule, string, color, and file is decided below. If something truly isn't covered, choose the simplest option consistent with the rest of the spec and list it under "Builder notes" at the end of `README.md`. Do not add features that aren't listed here.

## Overview

**Nudge** is a voice-first reminder app for iPhone that makes adding a reminder take seconds instead of minutes. You tap a big mic button (or type), say something like *"dentist next Tuesday at 3"* or *"finish my essay by 5pm"*, glance at what Nudge understood, and tap Save. Nudge then makes sure you don't forget. **Events** (appointments, meetings) get a heads-up before they start, and **tasks** nag you on a repeating schedule **until you mark them done**.

**Purpose:** adding calendar events on a phone is tedious, so people put it off and forget. Nudge removes that friction and is deliberately persistent about follow-through.

**Target audience:** students and busy people, especially anyone with ADHD-style "out of sight, out of mind" habits who needs reminders they can't ignore.

## Core Features

1. **Capture:** a text box (always visible) plus a big Voice Memos-style mic button on the home screen.
2. **Smart parsing on the phone** (no AI, no server): detects date/time, Event vs. Task, deadline, repeat, and splits multiple reminders from one sentence. Full rules in [Parsing Rules](#parsing-rules).
3. **Review before saving:** one editable card per parsed reminder, and Save / Save all.
4. **"Ask if no time":** if a reminder has no time, the card requires picking one or tapping **Not sure**. Not sure turns it into a task with no deadline that nags until done.
5. **Events:** one notification before the event (default 30 min). Non-repeating events auto-complete once their time passes.
6. **Tasks:** repeating nags (default every 60 min) with escalating messages until marked done. Nagging starts at a per-task "Start reminding me" time (default 3 hours before the deadline, or immediately if there's no deadline). Paused during quiet hours.
7. **Repeating events:** daily, weekdays, weekends, or specific weekdays.
8. **"Done ✓" button on task notifications** marks the task done without opening the app.
9. **Reminders list:** "To do" (tasks) and "Coming up" (events). Check off, uncheck, tap to edit, delete. Done items stay crossed out until the end of the day.
10. **Settings:** quiet hours, event heads-up time, nag frequency, default nag start, haptics on/off, send a test nudge, delete all.
11. **Haptics:** a success buzz on save and a light tick on check-off (if enabled).
12. **Persistence:** reminders and settings saved locally with AsyncStorage, surviving app restarts.
13. **Phase 2:** live speech-to-text on the mic button with a volume-reactive animation (development build only; Expo Go keeps the Phase 1 behavior).

## User Roles

Nudge is a single-user, on-device app with no accounts, sign-in, or network use.

| Role | Description | Permissions |
|------|-------------|-------------|
| Owner (the phone's user) | The person whose reminders these are | Full control: create, edit, complete, delete reminders; change settings; delete all data. Data never leaves the phone. |

## Screens & Navigation

### Navigator

- `src/app/_layout.tsx` uses an **Expo Router `Stack`** (`import { Stack } from 'expo-router'`), replacing the template's `NativeTabs`.
- `screenOptions`: `headerShown: false`, `contentStyle: { backgroundColor: Colors.background }`. Every screen draws its own header row (see each screen), so no native header APIs are needed.
- Screen `review`: `presentation: 'modal'` (iOS page sheet; swipe down dismisses it).
- All other screens use the default push presentation. iOS swipe-back stays enabled.
- The root layout also: loads fonts, loads storage, sets up notifications (see [Notifications](#notifications--background-tasks)), wraps everything in `<RemindersProvider>`, and keeps the splash screen visible (`SplashScreen.preventAutoHideAsync()`, already in the template) until **both** fonts and storage are loaded, then calls `SplashScreen.hideAsync()`.

| Screen | File | Purpose | Navigation |
|--------|------|---------|------------|
| **Capture** (home) | `src/app/index.tsx` | Greeting, text box, Next button, big mic button | Initial route. Gear icon → `/settings`. List icon → `/reminders`. Next or end of recording → `/review?text=…` |
| **Review** | `src/app/review.tsx` | Parse the text into cards, edit, Save | Modal over Capture. Save → `router.back()` + toast on Capture. Cancel / swipe down → back, discarding. |
| **Reminders** | `src/app/reminders.tsx` | "To do" and "Coming up" lists | Back chevron → Capture. Row tap → `/reminder/[id]` |
| **Edit Reminder** | `src/app/reminder/[id].tsx` | Edit one reminder with the same card UI as Review, Delete | Back chevron / Save / Delete → `router.back()` |
| **Settings** | `src/app/settings.tsx` | All preferences | Back chevron → Capture |

**Notification taps:** tapping the body of any Nudge notification opens the app and navigates to `/reminders`. Tapping the "Done ✓" action does not navigate (see Notifications).

### Shared header row (Reminders, Edit, Settings)

A row with `paddingHorizontal: 20`, height 56, inside the safe area:
- **Left:** a 44×44 round button (`surface` background) with SF Symbol `chevron.left` (size 18, color `text`) that calls `router.back()`.
- **Center:** the screen title (Nunito ExtraBold 22, color `text`).
- **Right:** an empty 44×44 spacer, so the title stays centered.

### Screen 1: Capture (`index.tsx`)

Layout, top to bottom, inside `SafeAreaView` (from `react-native-safe-area-context`), background `background`:

1. **Decorative blobs** (absolutely positioned, behind everything, `pointerEvents="none"`):
   - a 260px circle in `peach` at top-right (`top: -80, right: -90`)
   - a 220px circle in `mint` at bottom-left (`bottom: -70, left: -80`)
   - a 140px circle in `lavender` at `top: 180, left: -60`

   All at opacity 0.7.
2. **Top bar** (row, space-between, `paddingHorizontal: 20`, `paddingTop: 8`):
   - **Left:** a 44×44 round `surface` button, SF Symbol `gearshape` (size 20, `text` color) → `/settings`.
   - **Right:** a 44×44 round `surface` button, SF Symbol `list.bullet` → `/reminders`. If there's at least one active task, show a small coral badge (min 18×18, radius 9) at its top-right with the count of active tasks (Nunito Bold 11, white).
3. **Greeting** (`paddingHorizontal: 24`, `marginTop: 24`):
   - Line 1 (Nunito ExtraBold 30, `text`): "Good morning" from 5:00–11:59, "Good afternoon" from 12:00–16:59, "Good evening" otherwise.
   - Line 2 (Nunito Regular 17, `textSecondary`, `marginTop: 4`): "What do you need to remember?"
4. **Text box card** (`marginHorizontal: 20`, `marginTop: 24`, `surface` background, radius 24, padding 18, shadow `{color #243B3A, opacity 0.06, radius 16, offset 0/6}`):
   - `TextInput`, multiline, `maxLength: 300`, min height 96, Nunito Regular 18, color `text`
   - placeholder "e.g. Dentist next Tuesday at 3", `placeholderTextColor` `textSecondary`
   - `returnKeyType: 'done'`, `submitBehavior: 'blurAndSubmit'`, and `onSubmitEditing` triggers Next
   - Below it, right-aligned, appears only when the trimmed text is non-empty: a **"Next →"** pill button (`primary` background, white Nunito Bold 16, `paddingVertical: 12`, `paddingHorizontal: 22`, radius 999). It navigates to `/review` with param `text` = trimmed text.
5. **Mic area** (fills the remaining space, content centered, `paddingBottom: 32`):
   - **Mic button:** a 120×120 circle. Idle: `primary` background, SF Symbol `mic.fill` (size 44, white). Recording (Phase 2): `coral` background, SF Symbol `stop.fill`.
   - **Pulse rings:** 3 concentric circles (`coral` at opacity 0.25) behind the button, only while recording. Each ring's scale = `1 + 0.08 × ringIndex + 0.5 × normalizedVolume`, where `normalizedVolume = clamp(volume, 0, 10) / 10`, animated with Reanimated `withTiming` (100 ms). Phase 1 never shows rings.
   - **Label** under the button (Nunito SemiBold 15, `textSecondary`, `marginTop: 16`): "Tap to speak" when idle, "Listening… tap to stop" when recording.
   - **Phase 1 / Expo Go behavior on tap:** focus the TextInput (so the keyboard opens) and show the toast "Tap 🎤 on your keyboard to dictate". Phase 2 behavior is described under Build Phases.
6. **Toast** (shared component): a pill at the bottom of the screen, 24px above the safe-area bottom, `mint` background, Nunito Bold 15 `text`. Enters with Reanimated `FadeInDown`, exits with `FadeOutDown`, and auto-hides after 1800 ms. Used for "Saved ✓", "Saved 3 nudges ✓", and the dictation hint.

**After Save on Review:** Capture clears the text box and shows the toast. The toast text is passed back through a shared toast state in the provider (`showToast(message)`), not through route params.

### Screen 2: Review (`review.tsx`)

- Reads `text` from `useLocalSearchParams()` and runs `parseCapture(text, new Date(), settings)` **once on mount** to produce draft cards.
- **Header row:**
  - Left: a "Cancel" text button (Nunito SemiBold 17, `primary`) → `router.back()`
  - Center: the title "Review" (Nunito ExtraBold 20)
  - Right: a spacer
- **Body:** a `ScrollView` of `ReminderCard`s (`gap: 14`, padding 20), using `keyboardShouldPersistTaps="handled"`.
- **Footer** (sticky at the bottom, padding 20): a full-width pill button.
  - Label "Save" if there's 1 card, "Save all (N)" if more.
  - `primary` background, white Nunito ExtraBold 17, height 56.
  - Disabled (opacity 0.4) while any card is invalid. When disabled, show the hint text above it (Nunito Regular 14, `textSecondary`, centered): "Pick a time or tap Not sure on each card".
- If parsing yields 0 cards (it can't, since the text is non-empty, but guard anyway), show one empty Task card containing the raw text.

#### `ReminderCard` (shared by Review and Edit) — `src/components/reminder-card.tsx`

A card with background `peach` for tasks and `mint` for events, radius 24, padding 18, `gap: 12`. Contents in order:

1. **Title input:** `TextInput`, Nunito Bold 19, color `text`, multiline off, `maxLength: 120`. Must be non-empty after trimming.
2. **Chip row** (wrap, `gap: 8`). Chips are pills (height 34, `paddingHorizontal: 14`, radius 999, Nunito Bold 14):
   - **Type chip:** "📅 Event" or "✅ Task", `surface` background. Tap toggles the type. When switching to Event: `nagStartAt = null`. When switching to Task: `repeat = null`, and `nagStartAt` is recomputed with the default rule.
   - **When chip:** `yellow` background.
     - Text: the formatted date/time, prefixed "Due " for tasks with a deadline.
     - Task with no deadline: "No deadline" (`surface` background). Tapping it opens the picker preset to the next full hour and sets a deadline.
     - Missing time (`needsTime`): "Pick a time" with a 2px `coral` border and `coral` text.
     - Tap toggles an inline date/time picker below the chip row.
   - **Repeat chip** (events only): `lavender` background. Text: "Doesn't repeat", "Every day", "Weekdays", "Weekends", "Every Monday", or "Mon & Wed" (short names joined by ", " with " & " before the last). Tap toggles the repeat row (item 5).
3. **Inline date/time picker** (shown when the When chip is toggled open):
   - `DateTimePicker` from `@expo/ui/community/datetime-picker`, `mode="datetime"`, `value` = the current `dueAt` (or the preset, see the parsing rules). `onChange` sets `dueAt`.
   - For events, the minimum date is now.
   - Choosing a time clears `needsTime`.
   - Below the picker: a "Done" text button (`primary`) collapses it.
4. **"Not sure" button** (only when `needsTime` is true): an outlined pill (2px `primary` border, `primary` text) reading "Not sure — nag me until it's done". Tap sets `type = 'task'`, `dueAt = null`, `needsTime = false`, `nagStartAt = now`, `repeat = null`.
5. **Repeat row** (events only, shown when the Repeat chip is toggled open): pills for "Never", "Daily", "Weekdays", "Weekends", "Weekly".
   - "Weekly" = the weekday of `dueAt`.
   - If the parsed repeat was a custom weekday set, add a sixth pill showing it.
   - The selected pill has a `primary` background and white text; the others use a `surface` background.
6. **"Start reminding me" row** (tasks with a deadline only):
   - Label (Nunito SemiBold 14, `textSecondary`), then pills "Now", "1 hr before", "3 hrs before", "6 hrs before", "Custom".
   - "Custom" opens a second inline picker (`mode="datetime"`, max = `dueAt`).
   - Default selection = `settings.defaultNagStartHours` hours before.
   - If the computed start is in the past, store `now` and select "Now".
   - Caption below (Nunito Regular 13, `textSecondary`): "Nags every {interval label} until you tap Done". Interval label: "15 min", "30 min", "hour", or "2 hours".
7. **Remove** (Review only, only when there's more than 1 card): an `xmark` SF Symbol button (size 14) in the card's top-right corner that removes the card.

**Card validity:** a card is valid when the title is non-empty, `needsTime` is false, and, for events, `dueAt` exists and is in the future.

**On Save (Review):**
1. Convert each card to a `Reminder` (new `id`, `createdAt = now`, `status = 'active'`, `completedAt = null`).
2. For tasks: `nagStartAt = clamp(chosen, now, dueAt ?? ∞)`.
3. `addReminders(list)`, then persist (the provider does this).
4. If `settings.hasAskedNotificationPermission` is false, call `Notifications.requestPermissionsAsync()` and set the flag to true.
5. Call `rescheduleAllNotifications()`.
6. Play the success haptic.
7. Call `showToast(N === 1 ? 'Saved ✓' : `Saved ${N} nudges ✓`)` and `router.back()`.

### Screen 3: Reminders (`reminders.tsx`)

- Uses the shared header row with the title "Your nudges".
- **Notifications-off banner:** if notification permission status is `denied`, a `coral`-tinted card (`#FBE3DC`, radius 18, padding 14) appears at the top of the list.
  - Text: "Notifications are off, so Nudge can't remind you."
  - Button: "Open Settings", which calls `Linking.openSettings()`.
  - Permission is checked on focus with `Notifications.getPermissionsAsync()`.
- **Body:** a `ScrollView` (padding 20, `gap: 10`) with two sections. Section headings use Nunito ExtraBold 18, `text`, `marginTop: 8`.
  - **"To do"** contains tasks:
    - Active tasks first, sorted by: overdue (`dueAt < now`) first, then by `dueAt` ascending, then no-deadline tasks by `createdAt` ascending.
    - Then tasks completed today, sorted by `completedAt` descending.
    - If the section is empty: "Nothing to do. Enjoy it 🌿" (Nunito Regular 15, `textSecondary`).
  - **"Coming up"** contains events: active events sorted by `dueAt` ascending, then events completed today. If empty: "No upcoming events".
- **`ReminderRow`** (`src/components/reminder-row.tsx`): a pressable card. Background `peach` (task) or `mint` (event), radius 20, padding 16, row layout with `gap: 14`.
  - **Left:** a 28×28 circle checkbox with a 2px `primary` border. When done: filled `primary` with a white `checkmark` SF Symbol (size 14).
    - Tap → `toggleDone(id)` plus the tick haptic.
    - The check-off animates the title's strikethrough by fading the row's opacity to 0.55 over 200 ms.
  - **Middle:**
    - Title (Nunito Bold 17, `text`; when done, `textDecorationLine: 'line-through'` and opacity 0.55)
    - Subtitle (Nunito Regular 14, `textSecondary`) per the [subtitle rules](#list-subtitles)
  - **Overdue tasks:** a 4px `coral` left border, and the subtitle text in `coral`.
  - Tapping the row (outside the checkbox) opens `/reminder/[id]`.
- **Fully empty state** (no reminders visible in either section): show both section empty messages, plus a centered pill "Add a nudge" (`primary`) that calls `router.back()`.
- On screen focus (`useFocusEffect`), re-run `runMaintenance()` (see the data rules) so auto-completions are up to date.

### Screen 4: Edit Reminder (`reminder/[id].tsx`)

- Uses the shared header row with the title "Edit nudge".
- If the `id` isn't found, show the centered text "This nudge no longer exists." and a "Back" button.
- Shows one `ReminderCard` prefilled from the reminder (no Remove button).
- Below the card, a vertical button stack (`gap: 12`):
  - **"Save changes"**: full-width `primary` pill, disabled while the card is invalid. It calls `updateReminder(id, changes)`, then `rescheduleAllNotifications()`, then `router.back()`.
    - If the type, `dueAt`, or `repeat` changed and the reminder was done, set it back to `status: 'active'`.
  - **"Mark as not done"** (only if done): an outlined `primary` pill that calls `toggleDone(id)`.
  - **"Delete"**: text button, `coral`, Nunito Bold 16. It shows `Alert.alert('Delete this nudge?', 'This can't be undone.', [{text:'Cancel', style:'cancel'}, {text:'Delete', style:'destructive', onPress: …}])`. On confirm: `removeReminder(id)`, then `rescheduleAllNotifications()`, then `router.back()`.

### Screen 5: Settings (`settings.tsx`)

- Uses the shared header row with the title "Settings".
- **Body:** a `ScrollView` (padding 20, `gap: 16`) of section cards (`surface` background, radius 24, padding 18, `gap: 12`).
- **Section labels** use Nunito ExtraBold 16, `text`. **Captions** use Nunito Regular 13, `textSecondary`.
- **Every change saves immediately** and then calls `rescheduleAllNotifications()`.

1. **Quiet hours**
   - Row: label "Pause task nags overnight" plus a React Native `Switch` (`trackColor={{ true: Colors.primary }}`).
   - When on, two rows: "From" and "Until", each showing a `DateTimePicker` (`mode="time"`) bound to `quietHours.start` / `quietHours.end`, stored as `"HH:mm"`.
   - Caption: "Task nags pause during these hours. Events still notify."
2. **Event heads-up**
   - Pills: "At start" (0), "10 min" (10), "15 min" (15), "30 min" (30), "1 hr" (60).
   - Caption: "How early you're notified before an event."
3. **Nag me every**
   - Pills: "15 min" (15), "30 min" (30), "1 hr" (60), "2 hrs" (120).
   - Caption: "How often unfinished tasks remind you."
4. **Start nagging (tasks with a deadline)**
   - Pills: "1 hr" (1), "2 hrs" (2), "3 hrs" (3), "6 hrs" (6), each meaning "before the deadline".
   - Caption: "Default for new tasks. You can change it on each task."
5. **Haptics**
   - Row: label "Vibrate on save and check-off" plus a `Switch`.
6. **Try it**
   - Button "Send a test nudge" (outlined `primary` pill). It schedules a single notification 5 seconds from now:
     - title "⏰ Test nudge"
     - body "This is what a nag looks like. Tap Done to try it."
     - category `nudgeTask`
     - `data: { reminderId: null }`
   - Caption: "Arrives in 5 seconds. Lock your phone to see it."
   - If permission was never asked, request it first.
   - Purpose: lets the demo video show a notification without waiting an hour.
7. **Danger zone**
   - "Delete all nudges" text button in `coral`.
   - Shows an `Alert` ("Delete all nudges?" / "This removes every reminder from this phone." / Cancel / Delete destructive).
   - On confirm: `clearAllReminders()`, then `Notifications.cancelAllScheduledNotificationsAsync()`. Settings are kept.
8. **Footer** text (centered, Nunito Regular 13, `textSecondary`): "Nudge v1.0 · Everything stays on this phone."

Pills in Settings use the same style as the Repeat row pills: selected = `primary` background with white text, otherwise `background`-colored with `text`.

### List subtitles

Use these exact formats (see Date formatting):

| Reminder | Subtitle |
|---|---|
| Event, non-repeating | `{relativeDay} · {time}`, e.g. "Today · 3:00 PM", "Tomorrow · 9:30 AM", "Tue, Nov 25 · 3:00 PM" |
| Event, repeating | `{repeatLabel} · {time}`, e.g. "Every Monday · 7:00 PM" |
| Event, done (auto or manual) | `Done · {relativeDay} · {time}` |
| Task with deadline, nagging not started | `Due {relativeDay} · {time} · nags from {time of nagStartAt}` |
| Task with deadline, nagging started | `Due {relativeDay} · {time} · nagging every {interval label}` |
| Task, overdue | `Overdue · was due {relativeDay} · {time}` |
| Task, no deadline | `No deadline · nagging every {interval label}` |
| Task, done | `Done ✓` |

## Data Model

### Entities

All types live in `src/lib/types.ts`.

### Reminder
```ts
type ReminderType = 'event' | 'task';

type Repeat =
  | null
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }; // 0 = Sunday … 6 = Saturday (JS Date.getDay()), sorted, unique

interface Reminder {
  id: string;               // Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  text: string;             // trimmed title, e.g. "Dentist", "Finish essay"
  type: ReminderType;
  dueAt: string | null;     // ISO string. Event: event time (required). Task: deadline, or null = no deadline.
                            // Repeating events: the NEXT upcoming occurrence.
  nagStartAt: string | null;// ISO. Tasks: when nagging starts (required for tasks). Events: always null.
  repeat: Repeat;           // events only; always null for tasks
  status: 'active' | 'done';
  completedAt: string | null; // ISO, set when status becomes 'done'
  createdAt: string;        // ISO
}
```
"Weekdays" is stored as `{ kind: 'weekly', weekdays: [1,2,3,4,5] }`, and "Weekends" as `{ kind: 'weekly', weekdays: [0,6] }`.

### DraftReminder (Review/Edit only, never stored)
```ts
interface DraftReminder {
  key: string;              // React key
  text: string;
  type: ReminderType;
  dueAt: Date | null;
  needsTime: boolean;       // true = user must pick a time or tap Not sure
  pickerPreset: Date;       // initial value for the date picker when dueAt is null
  nagStartAt: Date | null;
  repeat: Repeat;
}
```

### Settings
```ts
interface Settings {
  quietHours: { enabled: boolean; start: string; end: string }; // "HH:mm" 24h
  eventLeadMinutes: 0 | 10 | 15 | 30 | 60;
  nagIntervalMinutes: 15 | 30 | 60 | 120;
  defaultNagStartHours: 1 | 2 | 3 | 6;
  hapticsEnabled: boolean;
  hasAskedNotificationPermission: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  eventLeadMinutes: 30,
  nagIntervalMinutes: 60,
  defaultNagStartHours: 3,
  hapticsEnabled: true,
  hasAskedNotificationPermission: false,
};
```

### Storage (`src/lib/storage.ts`)
- AsyncStorage key `nudge.reminders.v1` holds `JSON.stringify(Reminder[])`.
- AsyncStorage key `nudge.settings.v1` holds `JSON.stringify(Settings)`. On load, merge it over `DEFAULT_SETTINGS`, so missing fields get defaults.
- If loading or parsing throws: use `[]` and `DEFAULT_SETTINGS`, `console.warn` the error, and continue (never crash).
- Every write is full-replace (`setItem` of the whole array/object), done right after each state change.

### State (`src/lib/store.tsx`)
A React context, `RemindersProvider`, plus a `useNudge()` hook exposing:
- **State:** `reminders`, `settings`, `isLoaded`, `toast` (string | null)
- **Reminder actions:** `addReminders(rs)`, `updateReminder(id, patch)`, `removeReminder(id)`, `toggleDone(id)`, `clearAllReminders()`
- **Other actions:** `updateSettings(patch)`, `showToast(msg)`, `runMaintenance()`

**`toggleDone(id)`:**
- **Active → done:**
  - Non-repeating event or task: `status = 'done'`, `completedAt = now`.
  - Repeating event: do **not** mark done. Instead, advance `dueAt` to the next occurrence after the current `dueAt` (this means "skip this one").
- **Done → active:** `status = 'active'`, `completedAt = null`. For a task whose `nagStartAt < now`, set `nagStartAt = now`.
- Afterwards, call `rescheduleAllNotifications()`.

**`runMaintenance(now)`** runs on load, on app foreground (`AppState` → `'active'`), and on Reminders focus:
1. Non-repeating active events with `dueAt <= now`: set `status = 'done'`, `completedAt = dueAt`.
2. Repeating events with `dueAt <= now`: advance `dueAt` to the next occurrence after `now`.
3. Delete reminders with `status === 'done'` and `completedAt` older than 30 days.
4. Persist if anything changed, then call `rescheduleAllNotifications()`.

**"Completed today":** `completedAt` falls on the same local calendar date as now. Done items not completed today are hidden from the list but kept in storage (until the 30-day cleanup).

**Next occurrence** for a repeat, from a given time `t` (`src/lib/repeat.ts`):
- Keep the hour and minute of `dueAt`.
- Daily: next day.
- Weekly: the next date strictly after `t` whose `getDay()` is in `weekdays`.

## Parsing Rules

Implemented in `src/lib/parse.ts` as a pure function `parseCapture(text: string, now: Date, settings: Settings): DraftReminder[]`, using **`chrono-node`** (`import * as chrono from 'chrono-node'`, English `chrono.parse`). Steps, in order:

### 1. Normalize
- Trim, and collapse whitespace to single spaces.
- Remove one leading phrase, case-insensitively, if present: `remind me to`, `remind me`, `nudge me to`, `don't forget to`, `dont forget to`, `i need to`, `i have to`, `i should`, `please`.

### 2. Split into parts (max 5)
- Split candidates are: `;`, `, and `, `, then `, ` and then `, ` and also `, ` then `, ` and `, and `,`.
- A split is made **only if** the first word after the separator (lowercased, punctuation stripped) is in `ACTION_VERBS`:
  `call, text, email, buy, get, pick, pay, book, schedule, finish, submit, send, start, study, read, write, review, practice, clean, do, go, make, take, return, cancel, check, order, reply, sign, renew, print, wash, water, feed, fix, update, prepare, plan, apply, register, file, bring, drop, meet, attend, grab, cook, workout, exercise, walk, run, laundry, vacuum, charge`
- Otherwise the separator is left as text. So "dinner with Sam and Alex" stays one reminder, while "call mom and buy milk" becomes two.
- Drop empty parts. If there are more than 5 parts, merge the extras into the 5th.

### 3. For each part, detect repeat (events only)
Case-insensitive regex checks, in this order (first match wins). Remove the matched phrase from the text before date parsing:

| Phrase | Repeat |
|---|---|
| `every day`, `everyday`, `daily`, `each day` | `{ kind: 'daily' }` |
| `every weekday`, `on weekdays`, `weekdays` | weekly `[1,2,3,4,5]` |
| `every weekend`, `on weekends`, `weekends` | weekly `[0,6]` |
| `every <day>( and <day>)*` or `on <day>s( and <day>s)*`, where `<day>` = full or 3-letter day names | weekly with those days |
| `every week`, `weekly` | weekly `[weekday of the parsed dueAt, or of now if none]` |

When a weekday-based repeat is found, the first listed day name is put back as plain text (e.g. "every Monday at 7" → "Monday at 7") so chrono can find the first occurrence. A detected repeat forces `type = 'event'`.

### 4. Detect date/time
- `const results = chrono.parse(partText, now, { forwardDate: true })`. Use the **first** result only.
- **No result:** `dueAt = null` (step 6 decides what happens).
- **Has a result:** `date = results[0].start.date()`.
  - If `results[0].start.isCertain('hour')` is false (a date with no time, e.g. "Tuesday"):
    - Set `needsTime = true`, `dueAt = null`.
    - `pickerPreset` = that date at **09:00**, unless chrono implied an hour (e.g. "tonight", "this evening"), in which case use chrono's date as-is.
  - If the hour is certain but `isCertain('meridiem')` is false and the hour (1–12 clock) is between 1 and 7: add 12 hours ("at 3" → 3 PM).
  - If the final date is `<= now` and the user gave no explicit date (`!isCertain('day')`): add 1 day.
  - Then `dueAt = date`, `needsTime = false`.
- Remove `results[0].text` from the part text to build the title.

### 5. Detect deadline words
If the part (before removing the date) matches `\b(by|before|due|until|no later than)\b` immediately before the chrono match, the reminder is a **task with a deadline**, and this overrides event keywords.

### 6. Decide the type (when not already forced)
1. Repeat detected → `event`.
2. Deadline word → `task`.
3. The text contains any `EVENT_KEYWORDS` (whole word, case-insensitive) → `event`:
   `meeting, meet, appointment, appt, dentist, doctor, doctors, class, lecture, lab, recitation, exam, midterm, final, quiz, interview, dinner, lunch, breakfast, brunch, coffee, party, concert, game, flight, practice, rehearsal, office hours, session, event, birthday, haircut, recital, show, movie, wedding, call with, date with, hangout, game night, therapy, workout class, tutoring`
4. The text matches `\bwith [A-Z]` in the original casing (e.g. "with Sam") → `event`.
5. Otherwise → `task`.

### 7. Fill in times by type
- **Event, has `dueAt`:** done.
- **Event, no date at all:** `needsTime = true`, `pickerPreset = next full hour`.
- **Task, has `dueAt`:** `nagStartAt = max(now, dueAt − defaultNagStartHours h)`.
- **Task, `needsTime` (date without time):** keep `needsTime`. `nagStartAt` is computed once a time is picked.
- **Task, no date at all:** the user said nothing about time, so **ask**: `needsTime = true`, `pickerPreset = next full hour`. The card shows both the picker and the "Not sure" button.

### 8. Build the title
1. Remove the chrono match text and the repeat phrase.
2. Remove dangling words at the start or end: `at, on, by, before, due, until, for, this, next, the, in, to`.
3. Strip trailing punctuation `.,;:!-`, and collapse spaces.
4. Capitalize the first letter.
5. If the result is empty, use the normalized part text.

### Expected examples (use as unit-test cases; "now" = Sat Nov 21 2026, 10:00 AM)

| Input | Result |
|---|---|
| `dentist next Tuesday at 3` | 1 event "Dentist", Tue Nov 24* 3:00 PM |
| `finish my essay by 5pm` | 1 task "Finish my essay", due today 5:00 PM, nagStart 2:00 PM |
| `call mom` | 1 task "Call mom", needsTime (picker preset 11:00 AM today; Not sure offered) |
| `call mom and buy milk tomorrow` | 2 tasks: "Call mom" (needsTime), "Buy milk" (needsTime, preset tomorrow 9:00 AM) |
| `dinner with Sam and Alex at 7` | 1 event "Dinner with Sam and Alex", today 7:00 PM |
| `gym every Monday at 7am` | 1 event "Gym", weekly [1], Mon Nov 23 7:00 AM |
| `take meds every day at 9pm` | 1 event "Take meds", daily, today 9:00 PM |
| `meeting with Prof Lee Tuesday` | 1 event "Meeting with Prof Lee", needsTime, preset Tue Nov 24 9:00 AM |
| `remind me to submit hw due Sunday 11:59pm` | 1 task "Submit hw", due Sun Nov 22 11:59 PM, nagStart 8:59 PM |

\*If chrono resolves "next Tuesday" to a different week, accept chrono's result. The review step lets the user fix it. Don't hand-write date math to override chrono, except for the rules above.

## Date Formatting

`src/lib/format.ts` contains hand-written formatters (don't rely on `Intl`/locale APIs):
- `formatTime(d)` → `"3:00 PM"`: 12-hour clock, no leading zero on the hour, two-digit minutes, uppercase `AM`/`PM`.
- `relativeDay(d, now)` → `"Today"`, `"Tomorrow"`, `"Yesterday"`, otherwise `"Tue, Nov 25"` (3-letter weekday, 3-letter month, day number). Add `", 2027"` if the year differs from now.
- `formatWhen(d, now)` → `` `${relativeDay} · ${formatTime}` ``
- `repeatLabel(repeat)` → "Every day", "Weekdays", "Weekends", "Every Monday", "Mon & Wed", or "Mon, Wed & Fri"
- `intervalLabel(min)` → `15:"15 min"`, `30:"30 min"`, `60:"hour"`, `120:"2 hours"`. The Settings pills use their own labels as listed above.

## API & Backend

- **Authentication:** none.
- **Database:** none on a server. Local only, with `@react-native-async-storage/async-storage`.
- **Third-party APIs:** none. The app makes no network requests.

### Dependencies

Install each with `npx expo install <pkg>`, which picks SDK-58-compatible versions. **Do not use `npm install <pkg>`** for these.

| Package | Phase | Purpose | Notes |
|---|---|---|---|
| `expo-router` | 1 | Navigation | Already installed |
| `@react-native-async-storage/async-storage` | 1 | Persistence | Included in Expo Go (Expo docs recommend 2.2.0 for SDK 58) |
| `expo-notifications` | 1 | Local notifications, Done action | |
| `expo-haptics` | 1 | Buzzes | |
| `@expo/ui` | 1 | `DateTimePicker` from `@expo/ui/community/datetime-picker` | Already installed; included in Expo Go |
| `chrono-node` | 1 | Date parsing | Pure JS (npm latest 2.10.x) |
| `@expo-google-fonts/nunito` | 1 | Font | Use with `useFonts` from that package |
| `expo-symbols` | 1 | SF Symbol icons (`SymbolView`) | Already installed |
| `react-native-reanimated` | 1 | Rings, toast animations | Already installed |
| `react-native-safe-area-context` | 1 | Safe areas | Already installed |
| `expo-constants` | 1–2 | Detect Expo Go | Already installed |
| `expo-speech-recognition` | 2 | Live speech-to-text + volume | **v58.x exists on npm (58.0.1)**. Requires a development build. |

Native components used from React Native core: `View`, `Text`, `TextInput`, `Pressable`, `ScrollView`, `Switch`, `Alert`, `Linking`, `AppState`.

## Design & Branding

- **Color palette** (replace `src/constants/theme.ts` entirely; light mode only):

  ```ts
  export const Colors = {
    background: '#FBF7EF',   // warm cream – all screen backgrounds
    surface: '#FFFFFF',      // cards, inputs, round icon buttons
    primary: '#2F6F6B',      // deep teal – mic (idle), main buttons, selected pills, checkboxes
    text: '#243B3A',         // headings + body
    textSecondary: '#6F7F7D',// captions, subtitles, placeholders
    mint: '#D8F0E6',         // event cards, toast
    peach: '#FBD9CC',        // task cards
    lavender: '#E6DFF8',     // repeat chip, decorative blob
    yellow: '#FCEFC0',       // date/time chip
    coral: '#EE8B74',        // recording mic, overdue, destructive, badges, pulse rings
    coralTint: '#FBE3DC',    // notifications-off banner
  } as const;
  ```
- **Typography:** Nunito via `@expo-google-fonts/nunito`. Load `Nunito_400Regular`, `Nunito_600SemiBold`, `Nunito_700Bold`, `Nunito_800ExtraBold`. Map them in `theme.ts` as `Fonts.regular`, `Fonts.semibold`, `Fonts.bold`, `Fonts.extrabold`, and set the `fontFamily` per text (not `fontWeight`). Sizes are given per element above.
- **Spacing:** use multiples of 2/4. Screen horizontal padding is 20–24.
- **Radii:** cards 20–24, chips and buttons 999 (pill), icon buttons fully round.
- **Shadow** (cards on Capture only): `shadowColor '#243B3A', shadowOpacity 0.06, shadowRadius 16, shadowOffset {0, 6}`.
- **Style direction:** soft, warm, and calm, so nagging feels like a friend, not an alarm. Pastel-tinted cards, no hard borders (except the explicitly listed outlines), decorative pastel blobs on Capture only. No gradients and no images.
- **Icons:** SF Symbols via `SymbolView` from `expo-symbols`. Names used: `gearshape`, `list.bullet`, `mic.fill`, `stop.fill`, `chevron.left`, `checkmark`, `xmark`.
- **No hard-coded colors** in screens or components. Always use `Colors.*`.
- **app.json changes:**
  - `"name": "Nudge"`, `"slug": "nudge"`, `"scheme": "nudge"`, `"userInterfaceStyle": "light"`
  - splash `backgroundColor` → `"#FBF7EF"`
  - add `"expo-notifications"` to `plugins` (no options)
  - keep the existing icons (a custom icon is out of scope)
  - Phase 2 adds the speech plugin (see Build Phases)

## Platform Targets

- [x] iOS: tested on my iPhone with Expo Go (Phase 1) and a development build (Phase 2); the iOS Simulator as a backup
- [ ] Android: not targeted or tested. Don't add Android-specific code.
- [ ] Web: not targeted. Delete the template's `.web.tsx` files.

## Notifications & Background Tasks

All notifications are **local** (`expo-notifications`); there's no push server. Implemented in `src/lib/notifications.ts`.

### Setup (once, in the root layout, at module scope or the first effect)
- `Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) })`
- `Notifications.setNotificationCategoryAsync('nudgeTask', [{ identifier: 'done', buttonTitle: 'Done ✓', options: { opensAppToForeground: false } }])`. Identifiers must not contain `-` or `:`.
- Add `addNotificationResponseReceivedListener(handleResponse)`. On mount, also call `getLastNotificationResponseAsync()` and pass a non-null result to `handleResponse` (this covers a cold start from a notification).
- **`handleResponse(response)`:** let `id = response.notification.request.content.data?.reminderId`.
  - If `response.actionIdentifier === 'done'` and `id`: mark that reminder done (only if active; ignore if missing or already done), persist, and reschedule.
  - Else, if it's the default action: `router.push('/reminders')`.
  - Wait until storage is loaded before acting.

### Permission
- Requested on the **first Save** (Review) or the first "Send a test nudge", whichever comes first, via `requestPermissionsAsync()`. Then set `hasAskedNotificationPermission = true`. There's no welcome screen.
- If not granted, everything else still works, and the Reminders banner explains it (see Screen 3). Scheduling calls are skipped when permission isn't granted.

### `rescheduleAllNotifications()`: the single source of truth
Called after **every** change to reminders or settings, after `runMaintenance`, and when the app comes to the foreground. It always rebuilds everything from scratch:

1. `await Notifications.cancelAllScheduledNotificationsAsync()`
2. If permission isn't granted, stop.
3. Build a list of `{ date, title, body, categoryIdentifier?, data: { reminderId } }` candidates, with `now = new Date()`:
   - **Non-repeating active event:**
     - `t = dueAt − eventLeadMinutes`.
     - If `t > now`: one candidate at `t`. Title "📅 {text}". Body "Starts in {lead label} · {formatTime(dueAt)}", or "Starting now · {time}" when lead is 0.
     - Else, if `dueAt > now`: one candidate at `dueAt`, body "Starting now · {time}".
     - Lead labels: 10 → "10 min", 15 → "15 min", 30 → "30 min", 60 → "1 hour".
   - **Repeating event:** a candidate for each occurrence (starting at `dueAt`) within the next **7 days**, using the same rule per occurrence. Quiet hours do **not** apply to events.
   - **Active task:** nag times for the next **48 hours**, at most **12 per task**:
     - `k0 = max(0, ceil((now − nagStartAt) / interval))`
     - `t = nagStartAt + k0·interval`
     - Repeat while `t < now + 48h` and count < 12:
       - If quiet hours are enabled and `t` is inside them, move `t` to the next quiet-hours end time.
       - Push a candidate with `level = floor((t − nagStartAt)/interval)`, then `t += interval`.
     - Category `nudgeTask`.
   - **Quiet-hours check:** let `start` and `end` be minutes after midnight. If `start < end`, the time is quiet when `start <= m < end`. Otherwise (the period crosses midnight) it's quiet when `m >= start || m < end`.
4. Sort the candidates by date, drop any `<= now + 5s`, and **keep the first 60** (iOS allows 64 pending; leave headroom).
5. Schedule each with `Notifications.scheduleNotificationAsync({ content: { title, body, data, categoryIdentifier, sound: true }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date } })`.

Because the schedule only covers 48 hours / 60 notifications, it's refilled whenever the app opens, comes to the foreground, or anything changes. That's acceptable for v1, since the user opens the app regularly.

### Escalating nag messages (by `level`; level ≥ 4 uses the last row)
If the task has a deadline and the nag time is after `dueAt`, prefix the title with "Overdue: ".

| Level | Title | Body |
|---|---|---|
| 0 | `⏰ {text}` | `Time to get this done.` |
| 1 | `Still on your list: {text}` | `Tap Done when it's finished.` |
| 2 | `{text} is still waiting 👀` | `You've got this. Knock it out.` |
| 3 | `Hey. {text}. Seriously.` | `Nudge isn't going away until it's done.` |
| 4+ | `🚨 {text}: still not done` | `Do it now, then tap Done to make me stop.` |

### Other background behavior
There are no background fetch or background tasks. Auto-completion and "done today" visibility are computed by `runMaintenance` and at render time.

## Offline Behavior

Nudge is **fully offline**: parsing, storage, and notifications all happen on the phone. Phase 2 speech recognition sets `requiresOnDeviceRecognition: true` when `supportsOnDeviceRecognition()` returns true, otherwise `false`. In that case Apple's recognizer may use the network, and if it fails, the error path below applies.

## Analytics & Monitoring

None: no analytics, tracking, or crash reporting. Errors are caught and handled in-app:
- Storage failure → start empty and `console.warn`.
- Notification scheduling failure → `console.warn`; the reminder is still saved.
- Speech error (Phase 2) → stop recording, return the mic to idle, and toast "Couldn't hear that, try again or type it".

## Project Structure

Delete these template files:
- `src/app/explore.tsx`
- `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`
- `src/components/animated-icon.tsx`, `src/components/animated-icon.web.tsx`, `src/components/animated-icon.module.css`
- `src/components/hint-row.tsx`, `src/components/web-badge.tsx`, `src/components/external-link.tsx`, `src/components/ui/collapsible.tsx`
- `src/components/themed-text.tsx`, `src/components/themed-view.tsx`
- `src/hooks/use-color-scheme.ts`, `src/hooks/use-color-scheme.web.ts`, `src/hooks/use-theme.ts`
- `src/global.css`
- the unused images `assets/images/tabIcons/`, `react-logo*`, `expo-logo.png`, `expo-badge*.png`, `logo-glow.png`, `tutorial-web.png`

Keep `scripts/reset-project.js`, but don't run it.

The final structure:
```
src/
  app/
    _layout.tsx          Stack, providers, fonts, splash, notification setup, AppState listener
    index.tsx            Capture
    review.tsx           Review (modal)
    reminders.tsx        Reminders list
    settings.tsx         Settings
    reminder/[id].tsx    Edit
  components/
    reminder-card.tsx    Editable card (Review + Edit)
    reminder-row.tsx     List row
    mic-button.tsx       Mic + pulse rings (+ Phase 2 speech hook usage)
    pill.tsx             Selectable pill / chip
    screen-header.tsx    Shared back-chevron header
    toast.tsx            Toast
    icon-button.tsx      44×44 round SF Symbol button
  constants/
    theme.ts             Colors, Fonts
  lib/
    types.ts             Reminder, Repeat, Settings, DraftReminder, DEFAULT_SETTINGS
    storage.ts           AsyncStorage load/save
    store.tsx            RemindersProvider + useNudge()
    parse.ts             parseCapture()
    repeat.ts            nextOccurrence()
    format.ts            formatters
    notifications.ts     setup, permission, rescheduleAllNotifications(), handleResponse
    haptics.ts           success() / tick(), both no-ops if haptics are disabled
    speech.ts            Phase 2: safe wrapper around expo-speech-recognition
```
Use the `@/` import alias (already configured in `tsconfig.json`).

**Haptics (`src/lib/haptics.ts`):**
- `success()` → `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)`
- `tick()` → `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)`
- Both check `settings.hapticsEnabled` and swallow errors.

## Build Phases

### Phase 1: Expo Go (meets every assignment requirement)
Build in this order, and confirm the app runs in Expo Go after each step:
1. Delete the template files, add theme + fonts, Stack navigation with all 5 screens as stubs, the shared header, and app.json changes.
2. Types, storage, provider, Reminders list, Edit screen, check-off, delete, `runMaintenance`. Temporarily add sample data to test, then remove it.
3. `parse.ts` with the example table above (verify by logging or a quick script), the Review screen, and the Save flow with the toast.
4. Settings screen, haptics.
5. Notifications: setup, permission, `rescheduleAllNotifications`, escalation, quiet hours, Done action, test nudge.
6. The mic button in Phase 1 mode (focus input + hint toast).
7. Run `npx expo lint` and `npx tsc --noEmit`, and fix all errors.

### Phase 2: Development build (real voice)
1. `npx expo install expo-speech-recognition`, then add to app.json `plugins`:
   ```json
   ["expo-speech-recognition", {
     "microphonePermission": "Nudge uses the microphone so you can speak your reminders.",
     "speechRecognitionPermission": "Nudge turns your speech into text to create reminders."
   }]
   ```
2. **`src/lib/speech.ts`:**
   - Set `isExpoGo = Constants.executionEnvironment === 'storeClient'`.
   - If not Expo Go, load the module with a guarded `require('expo-speech-recognition')` inside `try/catch`. Export `speechAvailable` (a boolean) and the module (or null).
   - **The app must still run in Expo Go**, where `speechAvailable = false` and the mic keeps its Phase 1 behavior. Never import `expo-speech-recognition` at the top level of any file.
3. **Mic behavior** when `speechAvailable`:
   - **Tap (idle):**
     - `requestPermissionsAsync()`. If denied → toast "Microphone access is off. Enable it in Settings" and stay idle.
     - Otherwise `start({ lang: 'en-US', interimResults: true, continuous: true, addsPunctuation: true, requiresOnDeviceRecognition: <see Offline>, volumeChangeEventOptions: { enabled: true, intervalMillis: 100 } })`.
     - State becomes recording, and the text box is cleared.
   - **`result` event:** set the text box to the latest transcript (`event.results[0]?.transcript`).
   - **`volumechange` event:** feed `event.value` (−2…10) into the rings.
   - **Tap (recording):** `stop()`.
   - **`end` event:** go idle. If the trimmed transcript is non-empty, navigate to `/review?text=…`.
   - **`error` event:** go idle and show the error toast.
   - Recording automatically stops after **60 seconds**.
   - Before using these names, check the exact API names (`ExpoSpeechRecognitionModule`, `useSpeechRecognitionEvent`, option names) in the README of the installed version (`node_modules/expo-speech-recognition/README.md`).
4. Build and run with `npx expo run:ios`, which needs Xcode. To install on a personal iPhone, select the device with `npx expo run:ios --device` and sign with a free Apple ID in Xcode. A free-account install expires after 7 days.
5. If Phase 2 can't be completed, ship Phase 1. Nothing in Phase 1 may depend on Phase 2.

## Acceptance Criteria

The app is done when all of these pass on an iPhone (Expo Go for 1–12, a dev build for 13):

1. `npm install` then `npx expo start` runs, and the app opens in Expo Go on Capture with the cream theme and Nunito font.
2. Typing "dentist next Tuesday at 3" → Next shows 1 mint Event card at 3:00 PM. Save buzzes, shows "Saved ✓", and the item appears under "Coming up".
3. "call mom and buy milk" shows 2 task cards, both requiring a time. "Not sure" on one and a picked time on the other enables "Save all (2)".
4. "finish essay by 5pm" creates a task with "Start reminding me" defaulting to 3 hrs before.
5. Checking off a task crosses it out (with a tick haptic), and it's still visible but crossed out after an app restart that day.
6. Force-quitting and reopening the app keeps all reminders and settings (persistence).
7. Tapping a row opens Edit, changes save, and Delete asks for confirmation and removes it.
8. Settings changes persist across restarts and reschedule notifications.
9. "Send a test nudge" delivers a notification in about 5 s with a "Done ✓" action when the notification is long-pressed or expanded.
10. A task with nagging due now produces repeated notifications with escalating text. Tapping "Done ✓" marks it done in the list.
11. A non-repeating event in the past shows as done automatically.
12. `npx expo lint` and `npx tsc --noEmit` report no errors.
13. (Phase 2, dev build) Tapping the mic shows the coral recording state with rings reacting to voice and a live transcript. Tapping stop opens Review with the spoken text. In Expo Go, the mic still falls back to the keyboard hint.

## Constraints & Non-Goals

**Constraints**
- Expo SDK 58, Expo Router, TypeScript (`.tsx`/`.ts`), npm. Install Expo-related packages with `npx expo install`.
- Must run with `npm install` → `npx expo start` in Expo Go (Phase 1 features).
- Never create or edit `ios/` or `android/` by hand. Configure only through `app.json` and config plugins (`npx expo run:ios` generates them; they're git-ignored).
- iOS allows ≤ 64 pending local notifications (we use ≤ 60), so nags are scheduled ≤ 48 h ahead and refilled whenever the app is opened.
- Parsing is rule-based plus chrono, not AI, so the Review step is mandatory.
- Expo has no official speech-to-text module (`expo-speech` is text-to-speech only), hence `expo-speech-recognition` + a dev build for Phase 2.

**Non-goals (future ideas, don't build)**
- Google Calendar sync / Google sign-in / iPhone Calendar export (`expo-calendar`)
- AI/LLM parsing, any backend, push notifications from a server
- Monthly or custom repeat rules, repeating tasks, locations, attachments, sharing, categories or tags
- Dark mode, Android, web, widgets, Siri shortcuts, custom app icon
- Accounts, multi-device sync, onboarding/welcome screens
- Undo after save (the Review step replaces it)

## Open Questions

All design decisions are made. The items below can only be confirmed on a real device, so each has a **predefined fallback** and the builder doesn't need to ask:

- **Does the "Done ✓" action button appear in Expo Go?** Expected: yes. If not, it will appear in the Phase 2 dev build. No code changes either way.
- **Does "Done ✓" work when the app is fully closed?** It's handled by the response listener plus `getLastNotificationResponseAsync()` on launch. If it proves unreliable on device, change the action's `opensAppToForeground` to `true` (one-line change).
- **chrono-node edge cases** (e.g. "next Tuesday" week choice): accept chrono's result. The Review card lets the user correct it.
- **Haptics right after speech recognition:** Apple's docs say the Taptic Engine is silent while dictation is active. The success haptic fires on Save (after recording has ended), so this shouldn't matter.
