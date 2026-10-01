import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

/**
 * JavaScript mirror of the CSS tokens in src/global.css, for APIs that cannot
 * read Tailwind classes (navigation theme, status bar, native props).
 */
export const THEME = {
  light: {
    background: 'hsl(300, 12%, 98%)',
    foreground: 'hsl(280, 14%, 9%)',
    card: 'hsl(0, 0%, 100%)',
    cardForeground: 'hsl(280, 14%, 9%)',
    popover: 'hsl(0, 0%, 100%)',
    popoverForeground: 'hsl(280, 14%, 9%)',
    primary: 'hsl(333, 76%, 42%)',
    primaryForeground: 'hsl(0, 0%, 100%)',
    secondary: 'hsl(290, 9%, 93%)',
    secondaryForeground: 'hsl(280, 14%, 12%)',
    muted: 'hsl(290, 9%, 94%)',
    mutedForeground: 'hsl(280, 6%, 38%)',
    accent: 'hsl(330, 82%, 94%)',
    accentForeground: 'hsl(335, 78%, 30%)',
    destructive: 'hsl(0, 72%, 44%)',
    destructiveForeground: 'hsl(0, 0%, 100%)',
    border: 'hsl(290, 10%, 81%)',
    input: 'hsl(290, 10%, 72%)',
    ring: 'hsl(333, 76%, 42%)',
    glass: 'hsl(0, 0%, 100%)',
    glassBorder: 'hsl(332, 40%, 34%)',
    radius: '0.5rem',
  },
  dark: {
    background: 'hsl(285, 16%, 7%)',
    foreground: 'hsl(300, 12%, 96%)',
    card: 'hsl(285, 13%, 12%)',
    cardForeground: 'hsl(300, 12%, 96%)',
    popover: 'hsl(285, 12%, 15%)',
    popoverForeground: 'hsl(300, 12%, 96%)',
    primary: 'hsl(330, 92%, 68%)',
    primaryForeground: 'hsl(332, 80%, 9%)',
    secondary: 'hsl(285, 10%, 19%)',
    secondaryForeground: 'hsl(300, 12%, 96%)',
    muted: 'hsl(285, 10%, 16%)',
    mutedForeground: 'hsl(290, 9%, 74%)',
    accent: 'hsl(331, 52%, 22%)',
    accentForeground: 'hsl(330, 96%, 90%)',
    destructive: 'hsl(0, 88%, 70%)',
    destructiveForeground: 'hsl(0, 75%, 9%)',
    border: 'hsl(285, 10%, 27%)',
    input: 'hsl(285, 10%, 34%)',
    ring: 'hsl(330, 92%, 68%)',
    glass: 'hsl(285, 14%, 15%)',
    glassBorder: 'hsl(330, 70%, 86%)',
    radius: '0.5rem',
  },
} as const;

type ThemeColors = (typeof THEME)[keyof typeof THEME];

function toNavigationTheme(base: Theme, colors: ThemeColors): Theme {
  return {
    ...base,
    colors: {
      background: colors.background,
      border: colors.border,
      card: colors.card,
      notification: colors.destructive,
      primary: colors.primary,
      text: colors.foreground,
    },
  };
}

export const NAV_THEME = {
  light: toNavigationTheme(DefaultTheme, THEME.light),
  dark: toNavigationTheme(DarkTheme, THEME.dark),
} as const;
