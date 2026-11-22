/**
 * Pill-shaped building blocks: `Pill` (chips and selectable option pills) and
 * `PillButton` (action buttons such as Save, Next and "Not sure").
 */
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

const PRESSED_OPACITY = 0.7;
const DISABLED_OPACITY = 0.4;
/** Labels in fixed-height pills stop growing here, so large Dynamic Type sizes cannot spill out of the pill. */
const MAX_FONT_SCALE = 1.4;

export interface PillProps {
  label: string;
  onPress?: () => void;
  /** Selected: `Colors.primary` background with white (`Colors.surface`) text. */
  selected?: boolean;
  /** Background when not selected. Default `Colors.surface`. */
  backgroundColor?: string;
  /** Text colour when not selected. Default `Colors.text`. */
  textColor?: string;
  /** Draws a 2px border in this colour when set. */
  borderColor?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Chip / selectable pill: height 34, paddingHorizontal 14, radius 999, Nunito Bold 14. */
export function Pill({
  label,
  onPress,
  selected = false,
  backgroundColor = Colors.surface,
  textColor = Colors.text,
  borderColor,
  disabled = false,
  accessibilityLabel,
  style,
}: PillProps) {
  const containerStyle: StyleProp<ViewStyle> = [
    styles.pill,
    { backgroundColor: selected ? Colors.primary : backgroundColor },
    borderColor !== undefined && [styles.pillBordered, { borderColor }],
    style,
    disabled && styles.disabled,
  ];
  const text = (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[styles.pillLabel, { color: selected ? Colors.surface : textColor }]}>
      {label}
    </Text>
  );

  if (onPress === undefined) {
    return (
      <View
        accessible={accessibilityLabel !== undefined}
        accessibilityLabel={accessibilityLabel}
        style={containerStyle}>
        {text}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [containerStyle, pressed && styles.pressed]}>
      {text}
    </Pressable>
  );
}

export interface PillButtonProps {
  label: string;
  onPress: () => void;
  /** filled: `Colors.primary` background, white text. outlined: 2px `Colors.primary` border and text. Default filled. */
  variant?: 'filled' | 'outlined';
  /**
   * large: full width, height 56, Nunito ExtraBold 17 (Save, Save changes…).
   * medium: hugs its label, paddingVertical 12, paddingHorizontal 22, Nunito Bold 16 (Next →, Add a nudge…).
   * Default large.
   */
  size?: 'large' | 'medium';
  /** Disabled: opacity 0.4 and not pressable. */
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Pill-shaped action button (radius 999). */
export function PillButton({
  label,
  onPress,
  variant = 'filled',
  size = 'large',
  disabled = false,
  accessibilityLabel,
  style,
}: PillButtonProps) {
  const outlined = variant === 'outlined';
  const large = size === 'large';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        large ? styles.buttonLarge : styles.buttonMedium,
        outlined ? styles.buttonOutlined : styles.buttonFilled,
        outlined && !large && styles.buttonMediumOutlined,
        style,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <Text
        maxFontSizeMultiplier={large ? MAX_FONT_SCALE : undefined}
        style={[
          large ? styles.buttonLabelLarge : styles.buttonLabelMedium,
          outlined ? styles.buttonLabelOutlined : styles.buttonLabelFilled,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 34,
    // Keeps a long label inside a narrow chip row: the text truncates instead of overflowing.
    maxWidth: '100%',
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The border sits inside the 34px height; the padding gives back its 2px so the label stays 14px from the edge.
  pillBordered: {
    borderWidth: 2,
    paddingHorizontal: 12,
  },
  pillLabel: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLarge: {
    alignSelf: 'stretch',
    height: 56,
    paddingHorizontal: 24,
  },
  buttonMedium: {
    alignSelf: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  buttonFilled: {
    backgroundColor: Colors.primary,
  },
  buttonOutlined: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  // Same outer size as a filled medium button: the 2px border replaces 2px of padding.
  buttonMediumOutlined: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  buttonLabelLarge: {
    fontFamily: Fonts.extrabold,
    fontSize: 17,
    textAlign: 'center',
  },
  buttonLabelMedium: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    textAlign: 'center',
  },
  buttonLabelFilled: {
    color: Colors.surface,
  },
  buttonLabelOutlined: {
    color: Colors.primary,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
