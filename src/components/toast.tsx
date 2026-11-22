/**
 * The shared toast: "Saved ✓", "Saved 3 nudges ✓", the dictation hint and the
 * speech error messages.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Keyboard, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts } from '@/constants/theme';
import { useNudge } from '@/lib/store';

const GAP = 24;

/**
 * The shared toast pill. Reads `toast` from `useNudge()` and takes no props;
 * render it once, as the last child of a screen's root view.
 */
export function Toast() {
  const { toast } = useNudge();
  const insets = useSafeAreaInsets();
  // Capture mounts the toast at app start, with the keyboard closed; the listeners keep it current.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardWillShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    // iOS has no live regions: VoiceOver only speaks a toast when asked to.
    if (toast !== null) {
      AccessibilityInfo.announceForAccessibility(toast);
    }
  }, [toast]);

  // The keyboard height already covers the home-indicator inset.
  const bottom = GAP + (keyboardHeight > 0 ? keyboardHeight : insets.bottom);

  // The container stays mounted so the pill's exit animation can play when the message clears.
  return (
    <View pointerEvents="none" style={[styles.container, { bottom }]}>
      {toast !== null ? (
        <Animated.View
          key={toast}
          entering={FadeInDown}
          exiting={FadeOutDown}
          accessibilityRole="alert"
          style={styles.pill}>
          <Text style={styles.text}>{toast}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  pill: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: Colors.mint,
  },
  text: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: Colors.text,
    textAlign: 'center',
  },
});
