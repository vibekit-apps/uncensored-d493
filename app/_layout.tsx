// The app's frame. Every file in app/ is a screen (Expo Router): the tabs are
// in app/(tabs)/ (the first one, index.tsx, is what opens), app/login.tsx is
// /login, and app/detail.tsx would be /detail.
//
// It also covers every screen with the waking state while the app's server
// wakes up (components/WakingScreen.tsx; lib/api.ts decides when), so no
// screen has to handle it.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { WakingScreen } from '@/components/WakingScreen';
import { useWakingState } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  const waking = useWakingState();
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={waking ? 'light' : 'auto'} />
      <Stack screenOptions={{ headerShown: false }} />
      {waking && <WakingScreen state={waking} />}
    </View>
  );
}
