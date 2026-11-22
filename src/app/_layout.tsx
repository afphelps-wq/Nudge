/**
 * Root layout: providers, fonts, the splash screen, notification wiring, the
 * foreground listener and the Stack navigator.
 */
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { useFonts } from 'expo-font';
import {
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
  type ErrorBoundaryProps,
  type Href,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { setupNotifications, subscribeToResponses } from '@/lib/notifications';
import { markDoneFromNotification, RemindersProvider, useNudge, whenLoaded } from '@/lib/store';

// Keep the splash screen up until fonts and storage are ready (hidden below).
SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash screen was already hidden; nothing to hold.
});

// Foreground behaviour and the "Done ✓" action. Safe at module scope: it never throws.
setupNotifications();

// Capture is always at the bottom of the stack, even when a notification or a
// link opens another screen first, so "back" always has somewhere to go.
export const unstable_settings = { anchor: 'index' };

const navigationTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: Colors.background },
};

const ERROR_BODY = "Nudge hit a snag. Your reminders are safe on this phone.";

// --- navigation requested from outside React -----------------------------------
// A notification tap can arrive before the navigator exists (cold start). The
// request is held here and carried out once the Stack is on screen.

let pendingHref: Href | null = null;
let navigateWhenReady: ((href: Href) => void) | null = null;

function requestNavigation(href: Href): void {
  if (navigateWhenReady) {
    navigateWhenReady(href);
  } else {
    pendingHref = href;
  }
}

function openReminders(): void {
  requestNavigation('/reminders');
}

// --------------------------------------------------------------------------------

function RootNavigator() {
  const router = useRouter();
  const { isLoaded, runMaintenance } = useNudge();
  const [fontsLoaded, fontError] = useFonts({
    [Fonts.regular]: Nunito_400Regular,
    [Fonts.semibold]: Nunito_600SemiBold,
    [Fonts.bold]: Nunito_700Bold,
    [Fonts.extrabold]: Nunito_800ExtraBold,
  });

  // A font that fails to load must not strand the app on the splash screen;
  // text simply falls back to the system font.
  const ready = (fontsLoaded || fontError != null) && isLoaded;

  useEffect(() => {
    if (fontError != null) console.warn('[nudge] could not load fonts', fontError);
  }, [fontError]);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hide();
    // `navigate` (not `push`) so repeated notification taps do not stack screens.
    navigateWhenReady = (href) => {
      router.navigate(href, { withAnchor: true });
    };
    if (pendingHref !== null) {
      const href = pendingHref;
      pendingHref = null;
      navigateWhenReady(href);
    }
    return () => {
      navigateWhenReady = null;
    };
  }, [ready, router]);

  // Notification taps and the "Done ✓" action, including the one that launched the app.
  useEffect(
    () =>
      subscribeToResponses({
        whenLoaded,
        markDone: markDoneFromNotification,
        openReminders,
      }),
    []
  );

  // Coming back to the foreground: auto-complete past events and refill the
  // notification schedule (runMaintenance reschedules when it is done).
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') runMaintenance();
      previous = next;
    });
    return () => {
      subscription.remove();
    };
  }, [runMaintenance]);

  if (!ready) {
    // Same colour as the splash screen, so there is no flash while loading.
    return <View style={styles.loading} />;
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="review" options={{ presentation: 'modal' }} />
        <Stack.Screen name="reminders" />
        <Stack.Screen name="reminder/[id]" />
        <Stack.Screen name="settings" />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <RemindersProvider>
      <RootNavigator />
    </RemindersProvider>
  );
}

/**
 * Shown by Expo Router if a screen throws while rendering. It can appear before
 * the fonts have loaded; the font names then fall back to the system font.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const tryAgain = () => {
    retry().catch(() => {
      // Still failing; this screen stays up so the user can try again.
    });
  };

  return (
    <View style={styles.errorScreen}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorBody}>{ERROR_BODY}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={tryAgain}
        style={({ pressed }) => [styles.errorButton, pressed && styles.errorButtonPressed]}>
        <Text style={styles.errorButtonLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  errorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: Colors.background,
  },
  errorTitle: {
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    color: Colors.text,
    textAlign: 'center',
  },
  errorBody: {
    fontFamily: Fonts.regular,
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: Colors.primary,
  },
  errorButtonPressed: {
    opacity: 0.85,
  },
  errorButtonLabel: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: Colors.surface,
  },
});
