// The first tab. A working example of the one pattern every screen uses:
// load from this app's server with api() and show errors in words. While the
// server wakes, the app's frame covers the screen on its own (app/_layout.tsx).
// Replace it with the real app.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Field, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

type Item = { id: string; text: string; createdAt: string };

export default function Home() {
  const t = useTheme();
  const [items, setItems] = useState<Item[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setItems(await api<Item[]>('GET', '/api/items'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setError('');
    try {
      const item = await api<Item>('POST', '/api/items', { text });
      setItems((prev) => [item, ...(prev || [])]);
      setDraft('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen title="My App">
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field label="New item" value={draft} onChangeText={setDraft} onSubmitEditing={add} placeholder="Add an item" returnKeyType="done" />
        </View>
        <Pressable
          onPress={add}
          accessibilityRole="button"
          accessibilityLabel="Add"
          style={{ backgroundColor: t.accent, borderRadius: 12, height: 48, width: 48, marginBottom: 12, justifyContent: 'center', alignItems: 'center' }}
        >
          <Ionicons name="add" size={24} color={t.onAccent} />
        </Pressable>
      </View>
      {!!error && (
        <Pressable onPress={load} accessibilityRole="button">
          <Text style={{ color: t.danger, fontSize: 15, marginBottom: 8 }}>{error} Tap to retry.</Text>
        </Pressable>
      )}
      {items === null && !error ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={t.accent} />
      ) : (
        <FlatList
          data={items || []}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => <Row label={item.text} />}
          ListEmptyComponent={<Text style={{ color: t.muted, fontSize: 15 }}>Nothing yet. Add the first item.</Text>}
        />
      )}
    </Screen>
  );
}
