# Code Review: Nudge vs. SPEC.md

Reviewed 2026-11-22. Report only: no source file was changed.

## Summary

| Status | Count | Meaning |
|---|---|---|
| [PASS] | 23 | Implemented as the spec says, or a sound practice |
| [FAIL] | 1 | A reproduced bug |
| [WARN] | 20 | A risk, an unverified item, a deviation, or a quality issue |

The app matches the spec closely and the logic layer is well tested. The main things to act on:

1. **One reproduced bug:** a repeat chosen on a card is not lined up with the event's date, so a "Weekdays" event can notify on a Sunday (finding 24).
2. **Three acceptance criteria (9, 10, 13) cannot be confirmed without an iPhone.** The code paths exist, but notification delivery, the Done ✓ action and live speech have never been run on a device.
3. **Several behaviours follow the spec literally and still feel wrong in use** (findings 25 to 30). These are spec decisions to revisit, not coding mistakes.

### How this was checked

- Read every file in `src/` against SPEC.md.
- `npx tsc --noEmit`: exit 0. `npx expo lint`: exit 0. `npm test`: 199 of 199 pass. `npx expo-doctor`: 20 of 20 checks pass.
- `npx expo export --platform ios` (output sent to a temp folder): the iOS bundle builds.
- Ran small read-only scripts against `src/lib` to reproduce suspected edge cases. Their results are quoted in the findings.
- Clicked through the app in Chrome against the running dev server: capture, Review, Save, list, check-off, reload, Edit, Settings. Web is not a supported target, so this checks logic and flow, not iOS look and feel. The test data was removed afterwards.
- **Not possible here:** anything that needs an iPhone or simulator (notification delivery, the Done ✓ action, haptics, SF Symbols, the native date picker, speech).

---

## A. Acceptance criteria

1. **[PASS] AC1: the app starts on Capture with the cream theme and Nunito.**
   The iOS bundle builds and `expo-doctor` is clean. In the browser the app opened on Capture with the cream background and `Nunito_400Regular` as the computed font. Fonts load in [_layout.tsx:70-75](src/app/_layout.tsx#L70-L75), and the splash screen is held until fonts and storage are ready ([_layout.tsx:28-30](src/app/_layout.tsx#L28-L30), [_layout.tsx:79-87](src/app/_layout.tsx#L79-L87)). Opening it in Expo Go on a phone was not done here.

2. **[PASS] AC2: "dentist next Tuesday at 3" gives one mint Event card at 3:00 PM, and Save shows "Saved ✓" and lists it under "Coming up".**
   Seen in the browser: one card on `#D8F0E6` reading "Tue, Nov 24 · 3:00 PM", then "Dentist" under "Coming up". The success haptic is called at [review.tsx:84](src/app/review.tsx#L84); the buzz itself needs a phone.

3. **[PASS] AC3: "call mom and buy milk" gives two task cards that both need a time.**
   Seen in the browser: two peach cards with "Pick a time", Save disabled with the hint. After "Not sure" on one and a picked time on the other, "Save all (2)" was enabled and saved both with "Saved 2 nudges ✓". Code: [parse.ts:226-255](src/lib/parse.ts#L226-L255), [reminder-card.tsx:344-352](src/components/reminder-card.tsx#L344-L352), [review.tsx:131-134](src/app/review.tsx#L131-L134).

4. **[PASS] AC4: "finish essay by 5pm" is a task with "Start reminding me" on 3 hrs before.**
   Seen in the browser at 6:08 PM: "Due Tomorrow · 5:00 PM" with "3 hrs before" selected. If the deadline is less than 3 hours away, "Now" is selected instead, as the spec says ([reminders.ts:47-51](src/lib/reminders.ts#L47-L51), [reminders.ts:389-401](src/lib/reminders.ts#L389-L401)).

5. **[PASS] AC5: checking off a task crosses it out, and it stays visible that day after a restart.**
   Seen in the browser: after check-off and a reload, "Call mom" showed with a strikethrough, row opacity 0.55 and "Done ✓". The tick haptic is called at [reminders.tsx:56-59](src/app/reminders.tsx#L56-L59); the tick itself needs a phone.

6. **[PASS] AC6: reminders and settings survive a restart.**
   Seen in the browser across several reloads. Every change is written at once as a full replace ([store.tsx:139-145](src/lib/store.tsx#L139-L145), [storage.ts:292-321](src/lib/storage.ts#L292-L321)). A force-quit on a phone was not tested.

7. **[PASS] AC7: tapping a row opens Edit, changes save, Delete asks first.**
   Edit and "Save changes" were seen in the browser (the title changed and the list updated). The Delete confirmation was checked by reading only, because `Alert.alert` does nothing on web: [reminder/\[id\].tsx:63-77](src/app/reminder/%5Bid%5D.tsx#L63-L77) uses the exact strings from the spec.

8. **[PASS] AC8: Settings changes persist and reschedule notifications.**
   Seen in the browser: the nag interval set to 15 min was still stored after a reload. Each change saves and then reschedules ([settings.tsx:107-110](src/app/settings.tsx#L107-L110)). Whether the schedule on a phone really changes was not verifiable.

9. **[WARN] AC9: "Send a test nudge" delivers a notification with Done ✓ in about 5 seconds. Not verifiable without a phone.**
   The code is there: a 5-second trigger with the `nudgeTask` category and the spec's title and body ([notifications.ts:409-418](src/lib/notifications.ts#L409-L418), [notifications.ts:522-537](src/lib/notifications.ts#L522-L537)), and it asks for permission first ([settings.tsx:112-135](src/app/settings.tsx#L112-L135)). The payload is `{ test: true }` instead of the spec's `{ reminderId: null }`; see finding 22.

10. **[WARN] AC10: a task that is due to nag produces repeated, escalating notifications, and Done ✓ marks it done. Not verifiable without a phone.**
    The scheduling, escalation and Done logic are unit tested ([notifications.ts:212-247](src/lib/notifications.ts#L212-L247), [notifications.ts:551-566](src/lib/notifications.ts#L551-L566), [store.tsx:428-451](src/lib/store.tsx#L428-L451)). Two things to expect on a phone: the first nag arrives one full interval after saving, and it uses the level 1 wording. See finding 26.

11. **[PASS] AC11: a one-off event in the past shows as done automatically.**
    Seen in the browser: an active event dated two hours earlier loaded as "Done · Today · 4:07 PM", and was stored with `completedAt` equal to its `dueAt`. Code: [reminders.ts:522-556](src/lib/reminders.ts#L522-L556).

12. **[PASS] AC12: `npx expo lint` and `npx tsc --noEmit` report no errors.** Both exit 0.

13. **[WARN] AC13 (Phase 2): mic recording with rings and a live transcript. Not verifiable without a development build.**
    The implementation is complete on paper: [mic-button.tsx:188-237](src/components/mic-button.tsx#L188-L237), [speech.ts:16-58](src/lib/speech.ts#L16-L58), and the plugin entry in [app.json:42-48](app.json#L42-L48). The native module name used in the guard (`ExpoSpeechRecognition`, [speech.ts:19](src/lib/speech.ts#L19)) matches the installed package. The Expo Go fallback is in place ([mic-button.tsx:221-226](src/components/mic-button.tsx#L221-L226), [index.tsx:55-58](src/app/index.tsx#L55-L58)). The transcript merging in [speech.ts:65-72](src/lib/speech.ts#L65-L72) is a guess about how iOS reports results and has never run on a device.

## B. Spec conformance beyond the criteria

14. **[PASS] Navigator and root layout.** `Stack` with `headerShown: false` and the cream `contentStyle`, Review as a modal, the provider around everything, and maintenance on foreground: [_layout.tsx:115-124](src/app/_layout.tsx#L115-L124), [_layout.tsx:134-144](src/app/_layout.tsx#L134-L144), [_layout.tsx:149-155](src/app/_layout.tsx#L149-L155).

15. **[PASS] Screen layout, strings and sizes.** Spot-checked against the spec and all match: Capture blobs, top bar, greeting hours, text box and Next pill ([index.tsx:30-35](src/app/index.tsx#L30-L35), [index.tsx:142-224](src/app/index.tsx#L142-L224)); the shared header ([screen-header.tsx:50-70](src/components/screen-header.tsx#L50-L70)); Review header, footer and hint ([review.tsx:98-140](src/app/review.tsx#L98-L140)); the card's chips, rows and captions ([reminder-card.tsx:304-384](src/components/reminder-card.tsx#L304-L384)); the list row ([reminder-row.tsx:88-143](src/components/reminder-row.tsx#L88-L143)); every Settings section, label and caption ([settings.tsx:158-258](src/app/settings.tsx#L158-L258)); the toast ([toast.tsx:49-62](src/components/toast.tsx#L49-L62)).

16. **[PASS] Data model and storage.** Types and defaults are identical to the spec ([types.ts:1-66](src/lib/types.ts#L1-L66)). The two storage keys, the merge over defaults and the full-replace writes are as specified ([storage.ts:22-23](src/lib/storage.ts#L22-L23), [storage.ts:171-203](src/lib/storage.ts#L171-L203)).

17. **[PASS] Parsing rules.** Steps 1 to 8 are implemented in order in [parse.ts](src/lib/parse.ts), and all nine rows of the spec's example table are test cases in `scripts/logic-tests/parse.test.mjs` and pass.

18. **[PASS] `toggleDone`, `runMaintenance`, next occurrence, list order and subtitles.** [reminders.ts:472-556](src/lib/reminders.ts#L472-L556), [repeat.ts:61-83](src/lib/repeat.ts#L61-L83), [reminders.ts:600-649](src/lib/reminders.ts#L600-L649). The list order and subtitles seen in the browser matched the spec's table.

19. **[PASS] Notification scheduling.** Cancel all, stop without permission, build candidates, sort, drop anything within 5 seconds, keep 60: [notifications.ts:265-288](src/lib/notifications.ts#L265-L288), [notifications.ts:457-487](src/lib/notifications.ts#L457-L487). Quiet hours, the 48-hour and 12-per-task limits and the five escalation messages match the spec ([notifications.ts:120-139](src/lib/notifications.ts#L120-L139), [notifications.ts:212-247](src/lib/notifications.ts#L212-L247)).

20. **[PASS] Design rules.** The palette is exact ([theme.ts:6-18](src/constants/theme.ts#L6-L18)). A search of `src/` found no hard-coded colour outside `theme.ts`, no `fontWeight`, no `Platform` checks and no Android or web code. Only the seven listed SF Symbols are used.

21. **[PASS] Project structure and app.json.** Every template file on the spec's delete list is gone, the final tree matches, and `ios/` and `android/` do not exist. `name`, `slug`, `scheme`, `userInterfaceStyle` and the splash colour are set ([app.json:3-9](app.json#L3-L9), [app.json:31](app.json#L31)).

22. **[WARN] Deliberate deviations from the letter of the spec.** All are listed in the README's Builder notes with a reason. I checked the reasons that could be checked against the installed packages and they hold. Each still needs your accept or reject, since the spec said these things explicitly.

    | Spec says | Code does | Where | Reason checked? |
    |---|---|---|---|
    | `expo-notifications` plugin with no options | `enableRemoteNotifications: false` | [app.json:36-41](app.json#L36-L41) | Yes: the default adds the push entitlement |
    | `getLastNotificationResponseAsync()` | the sync `getLastNotificationResponse()` | [notifications.ts:605-608](src/lib/notifications.ts#L605-L608) | Yes: the async one is marked deprecated |
    | picker `onChange` | `onValueChange` | [reminder-card.tsx:100-102](src/components/reminder-card.tsx#L100-L102) | Yes: `onChange` is marked deprecated |
    | `router.push('/reminders')` on a notification tap | `router.navigate` once the Stack is mounted | [_layout.tsx:89-96](src/app/_layout.tsx#L89-L96) | Plausible, not run |
    | test nudge `data: { reminderId: null }` | `data: { test: true }` | [notifications.ts:414-415](src/lib/notifications.ts#L414-L415) | Plausible, not run |
    | `useFonts` from `@expo-google-fonts/nunito` | `useFonts` from `expo-font`, one import per weight | [_layout.tsx:5-9](src/app/_layout.tsx#L5-L9) | Works (font seen in browser) |
    | `Constants.executionEnvironment === 'storeClient'` | `isRunningInExpoGo()` | [speech.ts:14](src/lib/speech.ts#L14) | Yes: exported by `expo` |
    | text box shows `event.results[0]?.transcript` | merged across pauses | [mic-button.tsx:108-115](src/components/mic-button.tsx#L108-L115) | Not run |
    | done title also at opacity 0.55 | the fade is applied once, to the row | [reminder-row.tsx:44-45](src/components/reminder-row.tsx#L44-L45) | Yes: seen in browser |
    | state in a React context | a module-level store exposed through context | [store.tsx:72-112](src/lib/store.tsx#L72-L112) | Works |
    | "use the first chrono result only" | the first result that is not a course number or bare duration | [parse.ts:402-418](src/lib/parse.ts#L402-L418) | Yes: tested |
    | date-only preset is 09:00 | 09:00, or the next full hour if 09:00 has passed | [parse.ts:440](src/lib/parse.ts#L440) | Yes: tested |
    | "do not add features" | an error screen, tap-to-dismiss keyboard, a "Notifications are off" alert, retry of unreadable storage | [_layout.tsx:161-180](src/app/_layout.tsx#L161-L180), [settings.tsx:124-129](src/app/settings.tsx#L124-L129), [store.tsx:381-411](src/lib/store.tsx#L381-L411) | n/a |

23. **[WARN] Deviations that are not in the Builder notes.** The spec asks for these to be listed there.
    - Quiet hours with the same From and Until are treated as off ([notifications.ts:76](src/lib/notifications.ts#L76)). The spec's formula would make every minute quiet. The choice is sensible, but Settings gives no hint that the pause is no longer active.
    - Storage keeps at most 1000 reminders on load ([storage.ts:26](src/lib/storage.ts#L26), [storage.ts:142](src/lib/storage.ts#L142)). Anything beyond that is dropped and the next save makes it permanent. Unlikely to matter, since done items are pruned after 30 days.
    - Recording that ends with no words shows the "Couldn't hear that" toast ([mic-button.tsx:100-102](src/components/mic-button.tsx#L100-L102)). The spec only defines that toast for the `error` event.
    - `SplashScreen.hide()` is used instead of `hideAsync()` ([_layout.tsx:87](src/app/_layout.tsx#L87)).
    - The repeat parser also accepts "tues", "thur", "thurs", commas and "&" between days ([parse.ts:279-287](src/lib/parse.ts#L279-L287)).

## C. Bugs and logic errors

24. **[FAIL] A repeat chosen on the card is not lined up with the event's date.**
    The parser moves the first date onto a matching day ([parse.ts:360-364](src/lib/parse.ts#L360-L364)), but the card does not. `setDraftRepeat` ([reminders.ts:465-467](src/lib/reminders.ts#L465-L467)) leaves `dueAt` alone, and `setDraftDueAt` ([reminders.ts:310-319](src/lib/reminders.ts#L310-L319)) only follows a single-day repeat.
    Reproduced: "standup meeting tomorrow at 9am" typed on a Saturday gives Sunday 9:00 AM. Tapping Repeat and then "Weekdays" saves `dueAt` = Sunday with weekdays 1 to 5. The list shows "Weekdays · 9:00 AM", and the schedule contains a heads-up on Sunday 8:30 AM followed by Monday to Friday. By the same code path (read, not run), moving a "Weekdays" event's date to a Saturday in Edit leaves it off-pattern too. The stray occurrence comes from [notifications.ts:200-201](src/lib/notifications.ts#L200-L201), which starts from `dueAt` without checking it against the rule.

25. **[WARN] Un-doing a past one-off event does not stick, and a done past event cannot be saved in Edit.** Follows the spec; the two spec rules conflict.
    Unchecking it, or "Mark as not done" ([reminder/\[id\].tsx:94-100](src/app/reminder/%5Bid%5D.tsx#L94-L100)), makes it active. The next maintenance run, which happens when the list regains focus ([reminders.tsx:30](src/app/reminders.tsx#L30)), marks it done again ([reminders.ts:522-529](src/lib/reminders.ts#L522-L529)). Reproduced: active after the toggle, done after the next maintenance. In Edit the card is invalid because the time is in the past ([reminders.ts:149-151](src/lib/reminders.ts#L149-L151)), so "Save changes" stays disabled even for a rename.

26. **[WARN] "Nag me now" tasks get their first notification one interval later, and never get the level 0 message.** Follows the spec's formula.
    A task saved with `nagStartAt = now` is rescheduled a few milliseconds later, so `k0` is 1 ([notifications.ts:225-226](src/lib/notifications.ts#L225-L226)). Reproduced with the default settings: the first nag is 60 minutes after saving and reads "Still on your list: Call mom". "⏰ Call mom / Time to get this done." is never scheduled. The README mentions the delay but not the skipped message. For the demo of AC10, set the interval to 15 min and expect a 15-minute wait.

27. **[WARN] Task nags can crowd out event notifications.** Follows the spec's "keep the first 60".
    [notifications.ts:284-287](src/lib/notifications.ts#L284-L287) sorts by date and cuts at 60. Reproduced: five no-deadline tasks with default settings fill all 60 slots through 8:00 AM the next day, and an event at 3:00 PM the next day gets no notification until the app is opened again. With six tasks the schedule only reaches 8:00 PM the same day. A missed event heads-up costs more than a missed nag.

28. **[WARN] Two of the three reasons a card is invalid are never explained.** The hint text is fixed by the spec.
    A card is invalid for a missing time, an empty title, or an event in the past ([reminders.ts:146-153](src/lib/reminders.ts#L146-L153)). The only hint is "Pick a time or tap Not sure on each card" ([review.tsx:20](src/app/review.tsx#L20), [review.tsx:131](src/app/review.tsx#L131)), and Edit shows no hint at all. Reproduced: "dentist yesterday at 3pm" gives a normal-looking chip, "Yesterday · 3:00 PM", with Save disabled and no "Not sure" button. Opening the picker and tapping Done sets the time to the current minute ([reminder-card.tsx:127-136](src/components/reminder-card.tsx#L127-L136)), which is still not in the future, so the card stays invalid.

29. **[WARN] Some parses follow the rules and will still surprise people.** These come from the spec's keyword lists and its "1 to 7 means PM" rule. Run at 10:00 AM:
    - "dinner at 8" becomes tomorrow 8:00 AM, and "meeting at 9" becomes tomorrow 9:00 AM ([parse.ts:446-452](src/lib/parse.ts#L446-L452)).
    - "call mom before dinner" becomes an Event, because "dinner" is an event keyword and there is no date for "before" to attach to ([parse.ts:529-538](src/lib/parse.ts#L529-L538)).
    - "gym at 6" becomes a Task, since "gym" is not an event keyword.
    - "pay rent on the 1st" finds no date.
    The Review step lets the user fix all of these.

30. **[WARN] Tapping "No deadline" sets a deadline at once, with no way back.** Follows the spec.
    [reminder-card.tsx:270-274](src/components/reminder-card.tsx#L270-L274) sets the next full hour as soon as the chip is tapped. "Not sure" is only offered while a time is still missing ([reminder-card.tsx:344](src/components/reminder-card.tsx#L344)), so an accidental tap in Edit can only be undone by leaving without saving.

## D. Error handling

31. **[PASS] Storage failures never crash and never lose data that is still on disk.** Load and parse errors fall back to an empty list and defaults with a `console.warn` ([storage.ts:229-262](src/lib/storage.ts#L229-L262)). Everything read back is validated field by field ([storage.ts:87-133](src/lib/storage.ts#L87-L133)). A key that could not be read at all is not saved over ([store.tsx:132-145](src/lib/store.tsx#L132-L145)).

32. **[PASS] Notification failures are logged and do not affect the saved reminder.** Runs are queued one at a time, and each call has its own guard ([notifications.ts:397-404](src/lib/notifications.ts#L397-L404), [notifications.ts:479-486](src/lib/notifications.ts#L479-L486)). Seen in the browser, where the notification APIs do not exist: three `[nudge] could not…` warnings and no crash.

33. **[PASS] Speech errors return the mic to idle with a toast.** [mic-button.tsx:91-123](src/components/mic-button.tsx#L91-L123), [mic-button.tsx:193-196](src/components/mic-button.tsx#L193-L196). The package is loaded behind two guards ([speech.ts:16-27](src/lib/speech.ts#L16-L27)), and font or render failures do not strand the app ([_layout.tsx:79](src/app/_layout.tsx#L79), [_layout.tsx:161-180](src/app/_layout.tsx#L161-L180)).

34. **[WARN] Remaining gaps.**
    - A failed write is only logged ([storage.ts:304-308](src/lib/storage.ts#L304-L308)). The user still sees "Saved ✓" and loses the reminder on the next launch. The spec does not ask for more than a `console.warn`, so this is a spec-level risk.
    - Save waits for the permission prompt with no timeout before it shows the toast and closes ([review.tsx:79-87](src/app/review.tsx#L79-L87)). In the browser the prompt was never answered, and Review stayed open with Save disabled even though the reminder was already stored. On iOS the system prompt always resolves, so this should not happen there.
    - If Save throws, the button is re-enabled but the user is told nothing ([review.tsx:88-92](src/app/review.tsx#L88-L92)).
    - The quiet-hours picker does not check for an invalid date ([settings.tsx:90-94](src/app/settings.tsx#L90-L94)); the card pickers do ([reminder-card.tsx:100-102](src/components/reminder-card.tsx#L100-L102)). An invalid value would be stored as "NaN:NaN" and quiet hours would quietly stop working until the next launch.

## E. Code quality

35. **[PASS] Structure and readability.** Logic lives in pure, tested modules that take `now` as a parameter, and screens are thin. TypeScript is strict, there is no `any`, and comments explain why and not what. Names are mostly clear.

36. **[WARN] Repeated code.**
    - The 120-character title limit appears four times: [parse.ts:20](src/lib/parse.ts#L20), [reminders.ts:58](src/lib/reminders.ts#L58), [storage.ts:29](src/lib/storage.ts#L29), and a bare `120` at [reminder-card.tsx:309](src/components/reminder-card.tsx#L309).
    - Three copies of "trim and cut without splitting an emoji": [parse.ts:165-170](src/lib/parse.ts#L165-L170), [reminders.ts:107-113](src/lib/reminders.ts#L107-L113), [storage.ts:76-84](src/lib/storage.ts#L76-L84).
    - `isValidDate` three times: [parse.ts:172](src/lib/parse.ts#L172), [reminders.ts:66](src/lib/reminders.ts#L66), [reminder-card.tsx:66](src/components/reminder-card.tsx#L66). ISO parsing twice: [reminders.ts:76](src/lib/reminders.ts#L76), [notifications.ts:142](src/lib/notifications.ts#L142).
    - Weekday clean-up twice: [format.ts:81-87](src/lib/format.ts#L81-L87) and [repeat.ts:13-19](src/lib/repeat.ts#L13-L19). `sameDays` twice: [format.ts:89](src/lib/format.ts#L89), [reminders.ts:115](src/lib/reminders.ts#L115).
    - "Go back, or go to Capture if there is nothing to go back to" four times: [review.tsx:52-58](src/app/review.tsx#L52-L58), [reminders.tsx:71-77](src/app/reminders.tsx#L71-L77), [reminder/\[id\].tsx:21-31](src/app/reminder/%5Bid%5D.tsx#L21-L31), [screen-header.tsx:26-33](src/components/screen-header.tsx#L26-L33).
    - The allowed settings values are listed in both [storage.ts:31-33](src/lib/storage.ts#L31-L33) and [settings.tsx:27-47](src/app/settings.tsx#L27-L47). Time constants are repeated in [reminders.ts:31-33](src/lib/reminders.ts#L31-L33), [format.ts:33](src/lib/format.ts#L33) and [notifications.ts:59](src/lib/notifications.ts#L59).

37. **[WARN] Unclear names and mixed responsibilities.**
    - `remindersUnread` and `settingsUnread` ([store.tsx:132-133](src/lib/store.tsx#L132-L133), [storage.ts:225-226](src/lib/storage.ts#L225-L226)) mean "could not be read from disk" but read like "not yet seen by the user".
    - Three layers with near-identical names: `runMaintenance`, `maintain` and `applyMaintenance` ([store.tsx:271-287](src/lib/store.tsx#L271-L287), [reminders.ts:539](src/lib/reminders.ts#L539)); likewise `markDoneFromNotification`, `markDone` and `applyMarkDone` ([store.tsx:428-451](src/lib/store.tsx#L428-L451), [reminders.ts:515](src/lib/reminders.ts#L515)).
    - [reminders.ts](src/lib/reminders.ts) is 649 lines covering time helpers, draft editing, reducers, sorting and subtitles.
    - `useNow` lives in the store file but has nothing to do with the store ([store.tsx:483-505](src/lib/store.tsx#L483-L505)).
    - A leftover scaffolding comment: "seeded; `parse.ts` depends on these exact signatures" ([reminders.ts:28](src/lib/reminders.ts#L28)).

38. **[WARN] Mutable module-level state in five files.** The store ([store.tsx:72](src/lib/store.tsx#L72), [store.tsx:132-136](src/lib/store.tsx#L132-L136), [store.tsx:323-332](src/lib/store.tsx#L323-L332)), the notification queue and test-nudge bookkeeping ([notifications.ts:303-304](src/lib/notifications.ts#L303-L304), [notifications.ts:389](src/lib/notifications.ts#L389), [notifications.ts:407](src/lib/notifications.ts#L407), [notifications.ts:453-455](src/lib/notifications.ts#L453-L455)), the haptics flag ([haptics.ts:8](src/lib/haptics.ts#L8)), pending navigation ([_layout.tsx:50-51](src/app/_layout.tsx#L50-L51)) and a counter ([reminders.ts:125](src/lib/reminders.ts#L125)). It works and is commented, but the retry and merge logic in the store goes well beyond the spec and is the hardest part of the code to follow.

39. **[WARN] Leftovers.**
    - Dependencies that nothing in `src/` imports ([package.json:12-33](package.json#L12-L33)):
      - `expo-device`, `expo-image` and `expo-web-browser` are plain template leftovers.
      - `expo-glass-effect`, `react-native-gesture-handler`, `react-native-web` and `react-dom` are a dependency or optional peers of Expo Router. `react-native-web` and `react-dom` are what made the browser check possible.
      - `expo-constants` and `expo-linking` are required peers of Expo Router, so keep those.
    - `package.json` is still named `temp-app-name` ([package.json:2](package.json#L2)).
    - `app.json` still has the template's `android` block and `web.output: "server"` ([app.json:13-25](app.json#L13-L25)).
    - `loadReminders` and `loadSettings` are only used by tests ([storage.ts:265-272](src/lib/storage.ts#L265-L272)). `speechAvailable` is exported as the spec asks, but nothing reads it; the mic checks `speechModule` directly ([speech.ts:31](src/lib/speech.ts#L31)).

## F. React Native and Expo practices

40. **[PASS] Good practice throughout.**
    - SDK-matched package versions (`expo-doctor` clean), and native config only through `app.json`.
    - File-based routes with non-route code outside `src/app`.
    - `SafeAreaView` from `react-native-safe-area-context`, `Pressable` with press feedback and `hitSlop`, and `StyleSheet.create` everywhere.
    - Accessibility labels and roles on controls, a VoiceOver announcement for the toast ([toast.tsx:38-43](src/components/toast.tsx#L38-L43)), and capped Dynamic Type on fixed-height pills ([pill.tsx:12](src/components/pill.tsx#L12)).
    - Ring animation runs on the UI thread ([mic-button.tsx:57-71](src/components/mic-button.tsx#L57-L71)).
    - Render stays pure for the React Compiler: screens read the time from `useNow()` and never call `new Date()` while rendering.
    - Route params are treated as untrusted and cleaned before use ([parse.ts:198-202](src/lib/parse.ts#L198-L202)).
    - Current APIs are used where the spec named older ones (finding 22).

41. **[WARN] One context holds everything, so every consumer re-renders on every change.** The provider passes the whole snapshot ([store.tsx:458-467](src/lib/store.tsx#L458-L467)), and the Capture text lives in it ([index.tsx:95-96](src/app/index.tsx#L95-L96)). Each keystroke, live transcript update and toast re-renders every mounted screen that calls `useNudge()`. It is fine at this size, and the React Compiler limits the cost.

42. **[WARN] Only `src/lib` is tested.** The 199 tests cover parsing, rules, scheduling, storage and the store. No test covers a screen or component, so the card's picker and Done behaviour, the Review save flow and the mic state machine are only checked by hand. The README itself says the picker, notifications, haptics, SF Symbols and speech have never run on a device.

43. **[WARN] Small accessibility and web issues.**
    - The checkbox label is always "Mark … as done", including for an item that is already done ([reminder-row.tsx:60](src/components/reminder-row.tsx#L60)).
    - The type, when and repeat chips have no hint about what a tap does ([reminder-card.tsx:318-331](src/components/reminder-card.tsx#L318-L331)).
    - On web only, the nested button roles in the row ([reminder-row.tsx:46-82](src/components/reminder-row.tsx#L46-L82)) raise a "`<button>` cannot contain a nested `<button>`" error overlay on the list screen. iOS is not affected.
    - On web only, pressing Return in the Capture box did not submit; `submitBehavior` ([index.tsx:101-103](src/app/index.tsx#L101-L103)) needs checking on a phone.

44. **[WARN] None of the implementation is committed.** The repository has two commits (the spec and the starter). `git status` shows 8 modified files, 30 staged deletions and 8 untracked paths, including all of `src/lib`, `src/components` and the new screens.
