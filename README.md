# Nudge

Nudge is a voice-first reminder app for iPhone. Type or say something like *"dentist next Tuesday at 3"* or *"finish my essay by 5pm"*, check what Nudge understood, and tap Save. Events get a heads-up before they start; tasks nag you on a repeating schedule until you mark them done.

Everything runs on the phone: there is no account, no server and no network request. The full product spec is in [SPEC.md](SPEC.md).

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone Camera app to open Nudge in [Expo Go](https://expo.dev/go) (use `npx expo start --tunnel` if the phone and laptop cannot see each other on the network).

The app is built with Expo SDK 58 and Expo Router, for iOS only.

| Phase | How to run | What works |
|---|---|---|
| 1 | Expo Go | Everything except live voice. The mic button opens the keyboard so you can use its dictation key. |
| 2 | Development build: `npx expo run:ios --device` (needs Xcode) | Adds live speech-to-text on the mic button, with rings that react to your voice. |

## What it does

- **Capture:** a text box that is always there, plus a big mic button.
- **Smart parsing on the phone:** finds the date and time, decides Event or Task, spots deadlines ("by 5pm") and repeats ("every Monday"), and splits "call mom and buy milk" into two reminders. No AI, no server.
- **Review before saving:** one editable card per reminder. If you gave no time, the card asks for one, or you tap **Not sure** and it becomes a task that nags until it is done.
- **Events:** one notification before the event (30 minutes by default). Repeats: daily, weekdays, weekends or chosen weekdays.
- **Tasks:** nags every hour by default, with messages that escalate, starting at a time you choose. A **Done ✓** button on the notification marks the task done without opening the app. Nags pause during quiet hours.
- **Your nudges:** "To do" and "Coming up" lists. Check off, edit, delete. Done items stay crossed out until the end of the day.
- **Settings:** quiet hours, event heads-up time, nag frequency, default nag start, haptics, a test nudge, and delete all.
- **Saved on the phone:** reminders and settings survive restarts (AsyncStorage).

## Check it

```bash
npm test             # 214 logic tests (parsing, reminder rules, notification scheduling, storage, app state)
npx tsc --noEmit     # typecheck
npx expo lint        # lint
```

`npm test` uses Node's built-in test runner on the modules in `src/lib`, so it needs no simulator. It includes every row of the spec's "Expected examples" table.

## Where things are

```
src/app/                 screens (Expo Router): _layout, index (Capture), review, reminders, settings, reminder/[id]
src/components/          reminder-card, reminder-row, mic-button, pill, screen-header, toast, icon-button
src/constants/theme.ts   colours and fonts
src/lib/
  types.ts               Reminder, Settings, DraftReminder
  parse.ts               text -> draft reminders
  reminders.ts           reminder rules: card editing, check-off, auto-complete, list order, subtitles
  repeat.ts              repeat rules and next occurrence
  format.ts              date and label formatting
  notifications.ts       permission, scheduling, the Done action
  storage.ts             load and save, with validation
  store.tsx              app state: RemindersProvider, useNudge()
  haptics.ts, speech.ts
scripts/logic-tests/     the tests behind `npm test`
```

## Privacy and data

- Reminders and settings are stored only on the phone, as JSON in the app's own storage (AsyncStorage). That storage is not encrypted by the app; it is protected by iOS's device encryption and app sandbox, it is left out of iCloud and computer backups, and it is deleted with the app. It is fine for reminders and should not be used for passwords or similar secrets.
- The app makes no network requests and has no analytics or crash reporting.
- Reminder text is never written to the logs. Only caught errors are logged.
- Anything read back from storage, from a link that opens the app, or from a notification is validated before it is used, and nothing is ever saved without tapping Save.
- A reminder's title appears in its notification, so it can show on the lock screen. iOS controls that under Settings > Notifications > Show Previews.
- In the development build, speech is recognised on the phone when the device supports it; otherwise Apple's recogniser may use the network.

## Builder notes

These are the places where the build goes beyond, or differs from, the letter of SPEC.md, with the reason for each. Most come from checking the spec against the packages actually installed for Expo SDK 58.

### What has and has not been verified

- Verified here: typecheck, lint, 214 logic tests, Expo's project check (`npx expo-doctor`), and a full iOS bundle build.
- Also exercised in a desktop browser (the web build, which is not a supported target): app start, typing a reminder, Review, Save with the toast, the list, check-off, Edit, "Mark as not done", the two-task "Pick a time / Not sure" flow, and Settings persisting across reloads.
- **Not verified, because no iPhone or simulator was available while building:** how the native date picker looks and sizes itself inside the cards, notification delivery and the Done ✓ action, haptics, the SF Symbol icons, and live speech (Phase 2). Please run through the spec's Acceptance Criteria on a phone.

### Files beyond the spec's list

- `src/lib/reminders.ts` holds the reminder rules as plain functions, so they can be tested without a phone.
- `scripts/logic-tests/` and the `npm test` script. The spec asks for the parsing examples to be used as test cases.
- `eslint.config.js` (and the `eslint` / `eslint-config-expo` dev dependencies) were created by `npx expo lint` the first time it ran.

### State

- App state lives in a small store behind `RemindersProvider` / `useNudge()`, so the notification handler (which runs outside React) always sees the latest reminders.
- The store also holds the Capture text (`captureText`), which is how Review clears the text box after a Save.
- `useNudge().rescheduleAllNotifications()` takes no arguments. Overlapping calls are queued and merged, because two rebuilds running at once would schedule duplicates.
- `useNow()` supplies the current time to screens, refreshed every 30 seconds and when the app returns to the foreground.
- **Storage that cannot be read is not treated as empty.** The spec says to start with an empty list if loading fails. The app still does that on screen, but if the read itself failed (iOS can refuse file reads, for example when the app is started in the background on a locked phone), it does not save over the stored reminders or cancel the notifications already scheduled. It tries the read again after a moment and whenever the app comes back to the foreground, then merges in anything added meanwhile. Stored data that is readable but damaged is still replaced, as the spec says.

### Parsing

- **Course numbers and durations are not times.** chrono-node reads "15-113" as 3 PM and "for 2 hours" as two hours from now. Those matches are skipped, so "study for 15-113 exam" keeps its title and asks for a time.
- **"at 7" means today.** chrono moves a bare "at 7" to 7 AM tomorrow before the spec's "+12 hours" rule runs, which would put "dinner with Sam and Alex at 7" on tomorrow evening. The time is rebuilt on today's date first, so the spec's own example comes out as today 7 PM.
- A date with no time gets a 9:00 AM preset, or the next full hour if 9:00 AM has already passed (for example "clean room today").
- The deadline phrase is removed from the title ("finish essay no later than 3pm" becomes "Finish essay").
- "every Monday and Wednesday at 6pm" starts on the first listed day. "On weekdays" and "on weekends" start on the first day that matches.
- Not handled, as in the spec: "by 5" with no am/pm or colon is not a time for chrono, so the card asks for a time. Type "by 5pm".

### Review and Edit cards

- The date picker is the wheel style, which fits inside a card on every iPhone width. It is one constant in `reminder-card.tsx` if a calendar style is preferred.
- When a card is asking for a time, tapping the picker's **Done** accepts the time it is showing. Otherwise someone happy with the suggested time would have no way to confirm it.
- "Start reminding me": if the default in Settings is 2 hours, "Custom" shows as selected, because the spec has no "2 hrs before" pill.
- Switching a no-deadline task to an Event makes the card ask for a time, since an event needs one.
- **A repeating event's date is always on a day its repeat allows.** Choosing a weekly repeat that does not include the event's day (for example "Weekdays" on a Sunday event), or moving a repeating event to such a day, moves the date forward to the next allowed day at the same time. The date stays there if the repeat is then set back to "Never". Daily repeats never move the date. Events saved before this rule existed are also not notified on a day their repeat leaves out.
- Editing a task that is already nagging (for example renaming it) does not restart its nag schedule or reset the escalating messages.

### Lists and Capture

- A done row is faded once, at row level. Fading the row and the title as the spec lists them would multiply to about 30% opacity.
- The toast sits above the keyboard when the keyboard is open; the dictation hint appears exactly then and would otherwise be hidden.
- Tapping empty space on Capture puts the keyboard away.
- The "notifications are off" banner also re-checks when the app returns to the foreground, because coming back from the Settings app does not refocus the screen.

### Notifications

- `app.json` uses `["expo-notifications", { "enableRemoteNotifications": false }]`. With no options the plugin adds the push-notification entitlement, which a free Apple ID cannot sign in Phase 2. Nudge only uses local notifications.
- A notification tap opens the list with `router.navigate('/reminders')` once the app has finished loading, rather than `router.push` straight from the handler, which fails on a cold start.
- The test nudge carries `data: { test: true }` rather than `{ reminderId: null }`, because a null is not a valid value in an iOS notification payload.
- If the schedule is rebuilt during the 5 seconds before a test nudge (for example right after the permission prompt), the test nudge is put back instead of being cancelled.
- If notifications are off, "Send a test nudge" says so in an alert instead of doing nothing.
- **Event notifications are scheduled before task nags.** The spec keeps the first 60 notifications by date, which let five nagging tasks use every slot and leave tomorrow's event without a heads-up. Every event notification is now kept first (the earliest 60 if there are more), and task nags fill the remaining slots in date order.
- **"Start nagging now" is stored as one minute from now.** The spec stores the current time, but the schedule is rebuilt a moment later, so the first nag ("⏰ … Time to get this done.") was skipped and the next one only came a full interval later. This covers "Now" on a card, "Not sure", tasks with no deadline, a default start that has already passed, and un-checking a done task. The first nag now arrives about a minute after saving, and the scheduling steps themselves are unchanged, so reopening the app does not send it again. During that minute a task with a deadline reads "nags from {time}" in the list.
- Expo Go prints two warnings about push notifications when the notifications package loads. They do not apply to local notifications and are hidden.
- In Expo Go, notification permission belongs to Expo Go itself, so "Open Settings" opens Expo Go's settings page.

### Other

- The root layout includes a simple "Something went wrong / Try again" screen for unexpected errors, and it does not wait forever on the splash screen if a font fails to load.
- Fonts are loaded per weight (`@expo-google-fonts/nunito/400Regular` and so on) to avoid bundling all sixteen Nunito files.
- Speech (Phase 2): Expo Go is detected with `isRunningInExpoGo()`, and the transcript is built up across pauses, because on recent iOS versions each result can contain only the newest phrase.
- Speech (Phase 2): leaving Capture while recording (tapping Next, the gear or the list) stops the microphone. What was heard so far stays in the text box.
- Data loaded from storage is checked field by field; a damaged entry is dropped rather than crashing the app.
- Buttons and switches have accessibility labels for VoiceOver.
