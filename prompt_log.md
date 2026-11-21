# Prompt Log

## AI tools used

- **Claude Code** (desktop app, Code tab), running Claude Opus 5.5. Used for brainstorming, learning React Native/Expo concepts, and writing code.
- **Expo AI skills** (the Expo plugin for Claude Code). Gives Claude version-matched guidance for Expo SDK 58: routing, native UI, design system, and so on.

---

## Session 1: Setup, learning the basics, brainstorming (2026-11-21)

### 1. Assignment context
> Pasted the full assignment description (build an Expo/React Native app with at least 2 screens, user input, local data persistence with AsyncStorage, intentional design, plus SPEC.md, REVIEW.md, README.md, and this prompt log) and asked Claude to hold it as context before brainstorming.

**Outcome:** Claude summarized the requirements and deliverables, and the scope advice (a simple, polished app beats a buggy complex one).

### 2. Checking tools
> "Verify you have access to expo AI skills"

**Outcome:** Confirmed the Expo skills load. Found that the starter project uses **Expo SDK 58** with Expo Router and npm, and that AsyncStorage isn't installed yet.

### 3. Understanding the project structure
> "I am brand new to React Native, can you explain at a high level how these files create a working app"

> "So I have the settings in app.json and then the layout of the screens like the style along with theme.ts? is in layout.tsx and the index.tsx is the home screen and what does it mean by explore screen"

**Outcome:** Learned the role of each file:
- `app.json` holds app settings (name, icon, splash screen).
- `src/app/_layout.tsx` holds the navigation structure (tab bar, theme), not styling.
- `src/constants/theme.ts` holds shared colors, fonts and spacing.
- Each file in `src/app/` is a screen (file-based routing). `index.tsx` is Home, and `explore.tsx` is just a demo second tab.
- Expo Go on the phone runs the JavaScript bundle served by `npx expo start`.

### 4. React Native vs. the web
> "What's the difference between React Native and a regular website? How is a View different from a div"

> "What are some phone features that a website struggles with"

**Outcome:** React Native renders real native UI instead of HTML. `<View>` is like a `<div>`, but text must go inside `<Text>`, styling uses JavaScript objects, flexbox is on by default, and scrolling needs `<ScrollView>`. Phone-only strengths include notifications, haptics, sensors, health data, and widgets. Haptics and local storage are the easy wins that work in Expo Go.

### 5. Brainstorming the app idea
> "I like the idea of including push notifications and including haptics like small vibrations."

> "I kind of want an app that I could just speak to (like Wispr Flow) and it connects to either my gcal or something like that and can create a to-do list/events for me in an easier way. I want to reduce the friction to setting reminders as much as possible since I always dread adding calendar events on my phone."

**Outcome:** Core idea: a **low-friction reminder app**. Claude flagged the three hard parts of the full version (speech-to-text needs a custom build, parsing natural-language dates needs AI or a parsing library, Google Calendar needs sign-in and API setup). It also noted that reminders scheduled by the app are easier than server-sent push notifications. Plan: start with a simple version that keeps the low-friction goal and add those as stretch features.

### 6. First code: button and text input
> "How do I add a button and a text input to a React Native screen? Show me a simple example and explain the `useState` hook."

**Outcome:** Got a working example: a `TextInput` plus a `Pressable` button that adds reminders to a list. Learned that `useState` is a value React remembers that redraws the screen when it changes, what a controlled input is, and why you create a new array (`[...list, item]`) instead of using `push`.

### 7. Running the app
> "wait how do I try it?"

> "open up this file temp-app-name in vs code and continue this claude code session"

**Outcome:** Ran the app with `npx expo start` and scanned the QR code in Expo Go (`--tunnel` is the fallback if school Wi-Fi blocks the connection). Opened the project in VS Code. It worked on the phone.

### 8. Styling
> "ok it worked how can i change the text color in the box"

**Outcome:** `color` in the input's style controls the typed text, the `placeholderTextColor` prop controls the placeholder, and setting `backgroundColor` keeps the input readable in dark mode.

### 9. Brainstorming within scope
> "ok now I'm ready to actually develop my app idea. help me brainstorm keeping the app relatively simple with the ideas I've given so far"

**Outcome:** Claude proposed a simple voice-reminder app: use the keyboard's built-in dictation mic (no speech code), parse dates on the phone with the `chrono-node` library (no AI or backend), and schedule local notifications. Features were split into Core / Polish / Stretch / Later tiers.

### 10. Real voice button and the two-phase plan
> "Would I be able to create a button that uses the dictation button from the keyboard without the user having to go to the keyboard and press the button themselves? … I want the speaking button to be big and when you press it it kinda looks like voice memos recording. And I also like the buzz and to be notified at the right time."

**Outcome:** Apps can't trigger keyboard dictation. A real mic button needs a speech-recognition library, which requires a **development build** instead of Expo Go. I chose a **two-phase plan**: Phase 1 is the full app in Expo Go (the mic button falls back to the keyboard), and Phase 2 is a dev build with real live voice capture and a waveform animation. My phone is an iPhone.

### 11. Refining every detail
> "my phone is an iphone and im ok with the two phase build, now ask me as many questions as possible to refine all the details of this"

**Outcome:** Claude asked multiple rounds of multiple-choice questions. Key decisions:
- Name **Nudge**, soft and warm visual style.
- Two reminder types, auto-detected with a tap-to-flip chip:
  - **Events** notify 30 min before and auto-complete afterward.
  - **Tasks** nag **every hour until done** ("ADHD proof"), with escalating messages. Tasks with deadlines start nagging at a user-chosen time (default 3 hours before).
- No time said: the app asks to pick one. "Not sure" means hourly nagging.
- "Done ✓" button on the notification; quiet hours in Settings.
- Capture screen is home: text box always visible plus a big tap-start/tap-stop mic, then a quick review card before saving.
- List split into Tasks vs. Events; done items crossed out until end of day; tap to edit everything.
- Settings: quiet hours, event heads-up time, nag frequency, default nag start, haptics toggle.
- Haptics on save and check-off. v1 extras: repeating events, and multiple reminders from one sentence.

### 12. Visual style
> Shared a screenshot of a pastel wellness app: "I like these colors for the style"

**Outcome:** Claude extracted a palette (cream background, deep teal primary `#2F6F6B`, pastel mint/peach/lavender/yellow cards, coral for recording) and picked a rounded font (Nunito). Tasks get peach cards and events get mint cards.

### 13. Writing the spec
> Shared the course SPEC.md template: "use this"

**Outcome:** Claude checked the Expo SDK 58 docs before writing. It confirmed:
- AsyncStorage and the `@expo/ui` date picker work in Expo Go.
- Expo has no official speech-to-text module, so `expo-speech-recognition` needs a dev build.
- The notification trigger types and the "Done" action API.

It then filled in **SPEC.md** with features, screens and routes, the data model, notification rules (including iOS's 64-pending-notification limit), design tokens, build phases, non-goals, and open questions.

### 14. Making the spec agent-ready
> "this spec should be sufficient to hand to an agent to build a whole app, make sure the agent won't have to make any assumptions"

**Outcome:** Claude checked npm (found `expo-speech-recognition` 58.0.1 for SDK 58, which resolved an open question) and rewrote SPEC.md so nothing is left to guess:
- Exact layouts, sizes, fonts, and copy for every screen.
- TypeScript types and storage keys.
- Step-by-step parsing rules with keyword lists and test examples.
- The full notification scheduling algorithm (a 48h window, the 60-notification cap, quiet hours across midnight, escalation messages).
- The list of template files to delete, the final file structure, and app.json changes.
- Phase 2 speech details, including keeping the app runnable in Expo Go.
- Acceptance criteria.

Remaining device-only questions each have a predefined fallback. Claude also added a "Send a test nudge" button in Settings so the demo video can show a notification without waiting an hour.

### 15. GitHub
> Shared the empty GitHub repo: https://github.com/afphelps-wq/Nudge

**Outcome:** Connected the local project repo to GitHub as `origin` and pushed `main`.
