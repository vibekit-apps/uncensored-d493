// The app's colors, light and dark. Screens never hard-code a color: they call
// useTheme() (or use components/ui.tsx, which does). The phone's own light or
// dark setting picks the set (app.json userInterfaceStyle is "automatic").
// A palette the user gave (hex values) goes in here and nowhere else.
import { useColorScheme } from 'react-native';

export const light = {
  bg: '#f6f6fa',
  card: '#ffffff',
  text: '#14141c',
  muted: '#6b6b80',
  border: '#e2e2ea',
  accent: '#6a49f0',
  onAccent: '#ffffff',
  danger: '#dc2626',
};

export const dark: typeof light = {
  bg: '#0f0f14',
  card: '#1c1c26',
  text: '#f2f2f8',
  muted: '#8a8aa0',
  border: '#2a2a36',
  accent: '#7c5cff',
  onAccent: '#ffffff',
  danger: '#f87171',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
