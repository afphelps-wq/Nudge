/**
 * Nudge design tokens. Light mode only.
 * Screens and components must use these instead of hard-coded colors or font names.
 */

export const Colors = {
  background: '#FBF7EF', // warm cream – all screen backgrounds
  surface: '#FFFFFF', // cards, inputs, round icon buttons
  primary: '#2F6F6B', // deep teal – mic (idle), main buttons, selected pills, checkboxes
  text: '#243B3A', // headings + body
  textSecondary: '#6F7F7D', // captions, subtitles, placeholders
  mint: '#D8F0E6', // event cards, toast
  peach: '#FBD9CC', // task cards
  lavender: '#E6DFF8', // repeat chip, decorative blob
  yellow: '#FCEFC0', // date/time chip
  coral: '#EE8B74', // recording mic, overdue, destructive, badges, pulse rings
  coralTint: '#FBE3DC', // notifications-off banner
} as const;

export type ColorName = keyof typeof Colors;

/**
 * Nunito font families, loaded in the root layout with `useFonts` from
 * `@expo-google-fonts/nunito`. Set `fontFamily` per text; never `fontWeight`.
 */
export const Fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
} as const;

export type FontName = keyof typeof Fonts;
