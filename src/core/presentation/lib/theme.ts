import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

/**
 * JavaScript mirror of the CSS tokens in src/global.css, for APIs that cannot
 * read Tailwind classes (navigation theme, status bar, native props).
 */
export const THEME = {
  light: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(240 10% 3.9%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(240 10% 3.9%)',
    popover: 'hsl(0 0% 100%)',
    popoverForeground: 'hsl(240 10% 3.9%)',
    primary: 'hsl(333 72% 44%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(240 4.8% 95.9%)',
    secondaryForeground: 'hsl(240 5.9% 10%)',
    muted: 'hsl(240 4.8% 95.9%)',
    mutedForeground: 'hsl(240 3.8% 42%)',
    accent: 'hsl(327 73% 96%)',
    accentForeground: 'hsl(335 75% 30%)',
    destructive: 'hsl(0 72% 46%)',
    destructiveForeground: 'hsl(0 0% 100%)',
    border: 'hsl(240 5.9% 90%)',
    input: 'hsl(240 5.9% 90%)',
    ring: 'hsl(333 72% 44%)',
    radius: '0.5rem',
  },
  dark: {
    background: 'hsl(240 10% 3.9%)',
    foreground: 'hsl(0 0% 98%)',
    card: 'hsl(240 10% 3.9%)',
    cardForeground: 'hsl(0 0% 98%)',
    popover: 'hsl(240 10% 3.9%)',
    popoverForeground: 'hsl(0 0% 98%)',
    primary: 'hsl(329 86% 70%)',
    primaryForeground: 'hsl(336 70% 10%)',
    secondary: 'hsl(240 3.7% 15.9%)',
    secondaryForeground: 'hsl(0 0% 98%)',
    muted: 'hsl(240 3.7% 15.9%)',
    mutedForeground: 'hsl(240 5% 64.9%)',
    accent: 'hsl(336 45% 15%)',
    accentForeground: 'hsl(327 87% 88%)',
    destructive: 'hsl(0 84% 68%)',
    destructiveForeground: 'hsl(0 70% 10%)',
    border: 'hsl(240 3.7% 15.9%)',
    input: 'hsl(240 3.7% 15.9%)',
    ring: 'hsl(329 86% 70%)',
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
