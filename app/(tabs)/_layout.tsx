// The tab bar: one entry per file in this folder. To rename a tab change its
// `title`; to add one, add a file here and a Tabs.Screen for it; to drop one,
// delete its file and its Tabs.Screen. Icons: https://icons.expo.fyi (Ionicons).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} size={size} color={color} />;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
