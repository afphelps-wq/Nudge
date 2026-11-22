/**
 * Shared header row for Reminders, Edit and Settings.
 */
import { useCanGoBack, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/icon-button';
import { Colors, Fonts } from '@/constants/theme';

/** The row is a fixed 56px high, so the title stops growing here at large Dynamic Type sizes. */
const MAX_TITLE_FONT_SCALE = 1.4;

export interface ScreenHeaderProps {
  title: string;
}

/**
 * Shared header row for Reminders, Edit and Settings: back chevron (left),
 * centred title, 44×44 spacer (right). Height 56, paddingHorizontal 20.
 * The screen provides the safe-area padding around it.
 */
export function ScreenHeader({ title }: ScreenHeaderProps) {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  const goBack = () => {
    // A deep link can open a screen with nothing beneath it; then "back" means Capture.
    if (canGoBack) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <View style={styles.row}>
      <IconButton symbol="chevron.left" symbolSize={18} accessibilityLabel="Back" onPress={goBack} />
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_TITLE_FONT_SCALE}
        style={styles.title}>
        {title}
      </Text>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    marginHorizontal: 8,
    fontFamily: Fonts.extrabold,
    fontSize: 22,
    color: Colors.text,
    textAlign: 'center',
  },
  // Mirrors the back button so the title stays centred.
  spacer: {
    width: 44,
    height: 44,
  },
});
