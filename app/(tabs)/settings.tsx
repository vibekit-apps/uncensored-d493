// The second tab: small facts about the app. Rename or replace it (the tab's
// name and icon are in app/(tabs)/_layout.tsx).
import Constants from 'expo-constants';
import { Card, Row, Screen } from '@/components/ui';

export default function Settings() {
  const config = Constants.expoConfig;
  return (
    <Screen title="Settings" scroll>
      <Card>
        <Row label="App" right={config?.name ?? ''} />
        <Row label="Version" right={config?.version ?? ''} />
        <Row label="Appearance" detail="Follows your phone's light or dark setting" />
      </Card>
    </Screen>
  );
}
