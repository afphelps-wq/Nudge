/**
 * Round icon button used in the Capture top bar and as the back button of the
 * shared header.
 */
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

const PRESSED_OPACITY = 0.7;
const MAX_BADGE_COUNT = 99;
/** The badge is fixed-size chrome on a 44px button, so its digits barely follow Dynamic Type. */
const MAX_BADGE_FONT_SCALE = 1.2;

export interface IconButtonProps {
  symbol: SFSymbol;
  onPress: () => void;
  /** Required: the button has no visible text. */
  accessibilityLabel: string;
  /** SF Symbol point size. Default 20. */
  symbolSize?: number;
  /** When > 0, a small coral count badge is shown at the top-right. */
  badgeCount?: number;
  style?: StyleProp<ViewStyle>;
}

/** 44×44 round `Colors.surface` button holding an SF Symbol in `Colors.text`. */
export function IconButton({
  symbol,
  onPress,
  accessibilityLabel,
  symbolSize = 20,
  badgeCount = 0,
  style,
}: IconButtonProps) {
  const showBadge = badgeCount > 0;
  const badgeText = badgeCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : `${badgeCount}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // VoiceOver reads the count after the label; the badge itself is only visual.
      accessibilityValue={showBadge ? { text: badgeText } : undefined}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}>
      <SymbolView
        name={symbol}
        size={symbolSize}
        tintColor={Colors.text}
        resizeMode="scaleAspectFit"
      />
      {showBadge ? (
        <View pointerEvents="none" style={styles.badge}>
          <Text maxFontSizeMultiplier={MAX_BADGE_FONT_SCALE} style={styles.badgeText}>
            {badgeText}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No `overflow: 'hidden'`: the badge hangs over the edge of the circle and must not be clipped.
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    minHeight: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: Colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    color: Colors.surface,
    textAlign: 'center',
  },
});
