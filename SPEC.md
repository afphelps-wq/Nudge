# App Specification
<!-- Template created with CLAUDE for 15-113 -->

## Overview

**Nudge** is a voice-first reminder app for iPhone that makes adding a reminder take seconds instead of minutes. You tap a big mic button, say something like *"dentist next Tuesday at 3"* or *"finish my essay by 5pm"*, glance at what Nudge understood, and tap Save. Nudge then makes sure you don't forget. Appointments and events get a heads-up before they start, and tasks **nag you every hour until you mark them done**.

**Purpose:** adding calendar events on a phone is tedious (open the app, tap +, type a title, scroll the date wheel, set an alert…), so people put it off and then forget. Nudge removes that friction and is deliberately persistent about follow-through.

**Target audience:** students and busy people, especially anyone with ADHD-style "out of sight, out of mind" habits who needs a reminder that won't let them ignore it.

## Core Features

**Capture**
- Big round **mic button** styled like Voice Memos: tap to start, tap to stop. While recording, it turns coral, soft rings pulse with your voice volume, and your words appear live. *(Phase 2: see Constraints.)*
- A **text box is always visible** above the mic for typing instead. Keyboard dictation also works here.
- **Smart parsing** of the sentence (on the phone, no AI or server):
  - Detects the **date and time** ("tomorrow at 3", "next Friday", "by 5pm").
  - Guesses **Event vs. Task** from keywords ("meeting", "appointment", "dinner with", "class" mean Event; everything else is a Task). Shown as a chip you can tap to flip.
  - Detects **repeats** ("every day", "every Monday", "weekdays").
  - **Splits multiple reminders** in one sentence ("call mom and buy milk" becomes 2 reminders).
- **Quick review before saving:** a card for each reminder showing its text, type chip, date and time chip, and repeat chip. Everything is editable, and there's one **Save** (or **Save all**) button.
- **No time detected:** Nudge asks you to pick one with a date and time picker, or tap **"Not sure"**. "Not sure" makes it a Task that nags hourly until done.
- **Haptic buzz** (success) when saved, plus a brief "Saved ✓" confirmation. The text box clears, ready for the next one.

**Reminders**
- **Events** get one notification **before** the event (default 30 minutes, adjustable). After the event time passes they **auto-complete**.
- **Tasks** get **repeating nags** (default every hour, adjustable) until marked done:
  - **Task with a deadline:** nagging starts at a "Start reminding me" time you can set on the review card. The default is **3 hours before** the deadline.
  - **Task with no deadline** ("Not sure"): nagging starts right away.
  - Nag messages **escalate** each time ("Reminder: essay" → "Still need to do: essay" → "Essay is still waiting 👀" …).
  - No nags during **quiet hours** (set in Settings).
- **Repeating events** (daily, weekly, or specific weekdays) re-notify on each occurrence and never auto-complete.
- **"Done ✓" button on the notification** marks a task complete and stops the nagging without opening the app.

**List and editing**
- Reminders split into **To do** (tasks) and **Coming up** (events), sorted by time.
- **Tap the circle to check something off**, with a light haptic tick. Done items stay visible **crossed out until the end of the day**, then hide.
- **Tap a reminder to edit** everything: text, type, time, nag start, repeat. Delete from the edit screen.

**Settings**
- Quiet hours (on/off, start time, end time; default 10 PM – 8 AM)
- Event heads-up time (default 30 min)
- Nag frequency (default 60 min)
- Default nag start for tasks with deadlines (default 3 hours before)
- Haptics on/off

**Persistence:** all reminders and settings are saved on the phone with AsyncStorage, so they survive closing and reopening the app.

## User Roles

Nudge is a single-user, on-device app with no accounts or sign-in.

| Role | Description | Permissions |
|------|-------------|-------------|
| Owner (the phone's user) | The person whose reminders these are | Full control: create, edit, complete, delete reminders; change settings. Data never leaves the phone. |

## Screens & Navigation

Navigation uses an **Expo Router stack**, replacing the starter template's bottom tabs. **Capture is the home screen.** Small icon buttons in its top corners open the List (top-right) and Settings (top-left).

| Screen | Route / file | Purpose | Navigation |
|--------|-------------|---------|------------|
| **Capture** (home) | `src/app/index.tsx` | Greeting, text box, big mic button, live transcript while recording | Opens on launch. Corner icons push **Reminders** and **Settings**. Stop recording / tap Next opens **Review**. |
| **Review** | `src/app/review.tsx` (form-sheet modal) | One card per parsed reminder: text, Event/Task chip, date/time chip (opens picker), "Start reminding me" (tasks), repeat chip, Remove. Save / Save all. Also asks "Pick a time or Not sure" when no time was found. | Slides up over Capture. Save → haptic + toast → closes back to Capture. Cancel/swipe down discards. |
| **Reminders** | `src/app/reminders.tsx` | "To do" (tasks) and "Coming up" (events) sections; check off; empty state | Back arrow to Capture. Tap a row → **Edit**. |
| **Edit Reminder** | `src/app/reminder/[id].tsx` | The same card UI as Review, for one existing reminder, plus a Delete button | Pushed from Reminders. Save/Delete → back. |
| **Settings** | `src/app/settings.tsx` | Quiet hours, heads-up time, nag frequency, default nag start, haptics toggle | Back arrow to Capture. Changes save immediately. |

Non-route code (components, parsing, storage, notifications) lives outside `src/app/`, in `src/components/`, `src/lib/`, and `src/hooks/`.

## Data Model

### Entities

### Reminder
- `id`: string (unique, generated)
- `text`: string. The reminder title shown in the list and notification ("Dentist", "Finish essay").
- `type`: `'event' | 'task'`
- `dueAt`: string | null. ISO date-time. For an event, the event time. For a task, the deadline (null means no deadline / "Not sure").
- `nagStartAt`: string | null. Tasks only: when nagging begins (default `dueAt − 3h`, or the creation time when there's no deadline).
- `repeat`: `null | { kind: 'daily' } | { kind: 'weekly', weekdays: number[] }`. Weekdays are 1 = Sunday … 7 = Saturday.
- `status`: `'active' | 'done'`
- `completedAt`: string | null. Used to show crossed-out items until the end of that day.
- `createdAt`: string
- `notificationIds`: string[]. IDs of the scheduled notifications, so they can be cancelled on edit, complete, or delete.

### Settings
- `quietHours`: `{ enabled: boolean, start: 'HH:mm', end: 'HH:mm' }`. Default `{ true, '22:00', '08:00' }`.
- `eventLeadMinutes`: number. Default `30`.
- `nagIntervalMinutes`: number. Default `60`.
- `defaultNagStartHours`: number. Default `3`.
- `hapticsEnabled`: boolean. Default `true`.
- `hasAskedNotificationPermission`: boolean.

### Storage
- AsyncStorage key `nudge.reminders.v1` holds a JSON array of `Reminder`.
- AsyncStorage key `nudge.settings.v1` holds a JSON `Settings` object.
- Loaded once at app start into React state (a context/hook shared by all screens), and written back on every change.

## API & Backend

- **Authentication:** none (no accounts).
- **Database:** none on a server. Local only via `@react-native-async-storage/async-storage` (included in Expo Go).
- **Third-party APIs:** none. No network is needed. Libraries (installed with `npx expo install` where possible):
  - `expo-router`: navigation (already installed)
  - `@react-native-async-storage/async-storage`: persistence
  - `expo-notifications`: local scheduled notifications, the "Done" action button, permission request
  - `expo-haptics`: buzzes on save and check-off
  - `@expo/ui`: native SwiftUI date/time picker (`@expo/ui/community/datetime-picker`) and native switches/controls for Settings (already installed; included in Expo Go)
  - `chrono-node`: on-device natural-language date parsing (pure JavaScript, works in Expo Go)
  - `react-native-reanimated`: mic pulse/waveform animation (already installed)
  - `expo-font` + `@expo-google-fonts/nunito`: rounded friendly font
  - **Phase 2 only:** `expo-speech-recognition` (third-party). Uses Apple's built-in speech recognizer, giving live interim results and volume-level events for the waveform. Requires a development build.

## Design & Branding

Reference: soft pastel wellness-app style (cream backgrounds, pastel cards, deep teal buttons).

- **Color palette:**

  | Token | Hex | Use |
  |---|---|---|
  | `background` | `#FBF7EF` | Warm cream screen background |
  | `surface` | `#FFFFFF` | Cards, text box |
  | `primary` | `#2F6F6B` | Deep teal: mic button (idle), Save buttons, active icons |
  | `text` | `#243B3A` | Headings and body |
  | `textSecondary` | `#6F7F7D` | Times, hints, placeholders |
  | `mint` | `#D8F0E6` | Event cards, success toast |
  | `peach` | `#FBD9CC` | Task cards |
  | `lavender` | `#E6DFF8` | Repeat chips, Settings accents |
  | `yellow` | `#FCEFC0` | Date/time chip, "Today" highlights |
  | `coral` | `#EE8B74` | Mic while recording, escalated/overdue tasks |

- **Typography:** Nunito (Google Font) for everything: ExtraBold for screen titles, Bold for card titles and buttons, Regular/SemiBold for body. Falls back to the system font if loading fails.
- **Style direction:** soft, warm, and calm, so the nagging feels like a friend, not an alarm.
  - Very rounded corners: 24px cards, pill-shaped buttons and chips.
  - Pastel-tinted cards with no hard borders, and gentle shadows.
  - Soft pastel blob shapes in the screen corners as background decoration.
  - Generous spacing (8-point scale), large touch targets, a big mic (~120px).
  - Motion: mic pulse rings while recording, chips fade or pop in after parsing, check-off strikethrough animation.
  - All colors defined once as tokens in `src/constants/theme.ts`. No hard-coded hex values in screens.
  - Light mode only for v1, matching the cream style.

## Platform Targets

- [x] iOS (tested on my iPhone with Expo Go in Phase 1, and a development build in Phase 2; iOS Simulator as a backup)
- [ ] Android (not tested; the code avoids iOS-only APIs where easy, but no guarantees)
- [ ] Web

## Notifications & Background Tasks

All notifications are **local**: scheduled on the phone by `expo-notifications`, with no push server.

- **Permission:** requested the **first time the user saves a reminder**, with no welcome screen. If denied, reminders still save and show in the list, and a small banner on the Reminders screen explains that notifications are off.
- **Events:** one `DATE`-trigger notification at `dueAt − eventLeadMinutes` (e.g. "🦷 Dentist in 30 min · 3:00 PM").
- **Repeating events:** an iOS `CALENDAR` trigger with `repeats: true`, using hour/minute (daily) or weekday + hour/minute (weekly), shifted earlier by the lead time.
- **Tasks (nagging):**
  - Nags are scheduled as **individual `DATE` notifications** rather than one repeating trigger. That way each can have **escalating text** and can **skip quiet hours**.
  - Starting at `nagStartAt`, Nudge schedules one nag every `nagIntervalMinutes`, skipping times inside quiet hours, covering about the next 24 hours.
  - **iOS allows at most 64 pending local notifications per app**, so Nudge caps nags per task (~12) and tops up the schedule whenever the app opens or comes to the foreground.
- **"Done ✓" action:** a notification category `nudgeTask` with a `done` action button. The app listens with `addNotificationResponseReceivedListener`. On `done`, it marks the task done, cancels its remaining nags, and saves. On launch it also checks `getLastNotificationResponseAsync()` in case the app was closed when the button was pressed.
- **Rescheduling:** on every edit, complete, delete, or settings change, cancel that reminder's `notificationIds` and schedule fresh ones.
- **Foreground display:** `setNotificationHandler` shows banners even while Nudge is open.
- **No other background tasks.** The auto-completion of past events and the "end of day" hiding of done items are calculated whenever the list renders.

## Offline Behavior

Nudge is **fully offline**. Saving, parsing, notifications, and storage all happen on the phone. In Phase 2, speech recognition prefers **on-device** recognition (`requiresOnDeviceRecognition` where supported), so audio isn't sent over the network.

## Analytics & Monitoring

None. No analytics, tracking, or crash reporting, and no data leaves the phone. Errors are handled in-app: if storage fails to load, the app starts with an empty list and shows a small error message instead of crashing.

## Build Phases

**Phase 1: Expo Go (meets all assignment requirements)**
1. Theme tokens, Nunito font, stack navigation with Capture / Reminders / Settings.
2. Reminder data, AsyncStorage persistence, Reminders list, check-off, edit, delete.
3. Text capture → parsing (`chrono-node` + type/repeat/split rules) → Review sheet → Save.
4. Haptics, Settings screen.
5. Notifications: event heads-up, task nags with escalation and quiet hours, "Done" action.
6. The mic button is fully designed with its animation, but in Phase 1 tapping it focuses the text box so keyboard dictation can be used.

**Phase 2: Development build (real voice)**
1. Add `expo-speech-recognition` with its config plugin (microphone and speech permission strings).
2. Build and install with `npx expo run:ios` (Xcode, free Apple ID, personal iPhone) or on the iOS Simulator.
3. Wire the mic: live transcript, volume-driven waveform/rings, tap stop → Review.
4. If Phase 2 can't be finished, the Phase 1 fallback stays in place and the app still fully works.

## Constraints & Non-Goals

**Constraints**
- Built with Expo SDK 58 + Expo Router, in TypeScript (`.tsx`).
- Must run with `npm install` then `npx expo start` (Phase 1, Expo Go).
- **Expo has no official speech-to-text module** (`expo-speech` is text-to-speech only), so live voice capture needs the third-party `expo-speech-recognition` and a **development build**. A free Apple ID install on a personal iPhone **expires after 7 days** and must be rebuilt.
- iOS allows at most **64 pending local notifications** per app, which limits how far ahead nags can be scheduled.
- iOS repeating time-interval triggers must be at least 60 seconds apart (not an issue at 30+ minutes).
- Parsing uses rules plus `chrono-node`, not AI, so unusual phrasing may be misread. That's why there's a review step.

**Non-goals (future ideas, out of scope for v1)**
- Google Calendar sync or Google sign-in
- Saving events into the iPhone Calendar app (`expo-calendar`), a likely future path to Google Calendar without sign-in
- AI/LLM parsing or any backend server
- Server-sent push notifications
- Monthly or custom repeat rules, attachments, locations, sharing
- Dark mode, Android and web support, home-screen widgets, Siri shortcuts
- Accounts, multi-device sync

## Open Questions

- Does `expo-speech-recognition` have a release for **Expo SDK 58**? The README only lists SDK 56 and 57. Check npm before Phase 2.
- Do notification **categories / action buttons** ("Done ✓") work in **Expo Go**, or only in a development build? Test on device early in Phase 1.
- Does the "Done" action reliably mark tasks complete when the app is **fully closed**, or does it need to open the app? If unreliable, set the action to open the app.
- How should splitting handle "and" inside one reminder ("dinner with Sam **and** Alex")? Plan: only split when both halves look like separate actions (each starts with a verb or has its own time); otherwise keep one reminder. The review step catches mistakes.
- Should an event auto-complete at its start time, or a bit after (e.g. 1 hour later)? Default: at the start time.
- Exact wording of the escalating nag messages (about 4–5 levels).
- Do haptics behave normally right after speech recognition ends? Apple notes the Taptic Engine is silent while dictation is active.
