// The app's small UI kit: Screen, Card, Row, Field, Button, PhotoField. Plain React Native,
// colored by lib/theme.ts, so a restyle is one edit there. Use these for every
// screen so the app looks like one app; add a new piece here when two screens
// need it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../lib/theme';
import { shrinkPhoto, type ShrunkPhoto } from '../lib/shrink-photo';

/** A full screen with the app's background and an optional big title.
 *  `scroll` for a screen of forms or cards; leave it off when the screen is a FlatList. */
export function Screen({ title, scroll, children }: { title?: string; scroll?: boolean; children: ReactNode }) {
  const t = useTheme();
  const head = title ? <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', color: t.text, marginTop: 16, marginBottom: 12 }}>{title}</Text> : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {head}
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          {head}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

/** A raised box that groups related things. */
export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: t.border }}>{children}</View>;
}

/** One line in a list: a label, an optional smaller line under it, and something on the right
 *  (text or an icon). Pass onPress to make the whole row tappable. */
export function Row({ label, detail, right, onPress }: { label: string; detail?: string; right?: ReactNode; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 17 }}>{label}</Text>
        {!!detail && <Text style={{ color: t.muted, fontSize: 14, marginTop: 2 }}>{detail}</Text>}
      </View>
      {typeof right === 'string' ? <Text style={{ color: t.muted, fontSize: 15 }}>{right}</Text> : right}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>{body}</Pressable> : body;
}

/** A labeled text box. Takes every TextInput prop (secureTextEntry, keyboardType, ...). */
export function Field({ label, ...input }: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.muted, fontSize: 14, marginBottom: 6 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        {...input}
        style={[{ backgroundColor: t.card, color: t.text, borderRadius: 12, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 }, input.style]}
      />
    </View>
  );
}

/** The one tappable thing. `plain` is a quiet text button (Cancel, Sign out); `loading` shows a spinner and ignores taps. */
export function Button({ label, onPress, plain, loading }: { label: string; onPress: () => void; plain?: boolean; loading?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading }}
      style={{ backgroundColor: plain ? 'transparent' : t.accent, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', marginTop: 4, marginBottom: 8 }}
    >
      {loading ? <ActivityIndicator color={plain ? t.accent : t.onAccent} /> : <Text style={{ color: plain ? t.accent : t.onAccent, fontSize: 16, fontWeight: '600' }}>{label}</Text>}
    </Pressable>
  );
}

/** A labeled photo picker. Picks from the library (`camera` takes one instead), shrinks it with
 *  shrinkPhoto, shows it, and hands the result to onChange: send `photo.dataUrl` in JSON, or
 *  uploadFile it. `value` is what to show: a dataUrl, `fileUrl(url)` for an uploaded one, or null.
 *  `square` (pixels) cuts a centred square instead, as a profile photo is. `onBusy` hears when
 *  a picked photo is still being shrunk (true as the shrinking starts, false once onChange has it
 *  or it failed), so a form can hold its Save. Nothing is reported once the field is gone. */
export function PhotoField({ label, value, onChange, camera, square, onBusy }: { label: string; value?: string | null; onChange: (photo: ShrunkPhoto | null) => void; camera?: boolean; square?: number; onBusy?: (busy: boolean) => void }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Each press takes a number when it launches the picker, and only the newest
  // press may act on what comes back. The web picker can be dismissed with no
  // callback, so a press cannot wait for the one before it to finish.
  const latest = useRef(0);
  // Every press waiting on the picker or the shrink is void once the field is gone.
  useEffect(() => () => { latest.current++; }, []);
  const pick = async () => {
    const mine = ++latest.current;
    setError('');
    try {
      if (camera) {
        const allowed = (await ImagePicker.requestCameraPermissionsAsync()).granted;
        if (mine !== latest.current) return;
        if (!allowed) {
          setError('Allow the camera in Settings to take a photo.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
      const picked = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (mine !== latest.current || picked.canceled || !picked.assets?.length) return;
      setBusy(true);
      onBusy?.(true);
      const photo = await shrinkPhoto(picked.assets[0], { square });
      if (mine === latest.current) onChange(photo);
    } catch (e: any) {
      if (mine === latest.current) setError(e?.message || "This photo can't be used. Try another.");
    } finally {
      if (mine === latest.current) { setBusy(false); onBusy?.(false); }
    }
  };
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: t.muted, fontSize: 14, marginBottom: 6 }}>{label}</Text>
      <Pressable
        onPress={busy ? undefined : pick}
        accessibilityRole="button"
        accessibilityLabel={value ? `Change ${label}` : label}
        style={{ backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, height: 180, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        {busy ? <ActivityIndicator color={t.accent} />
          : value ? <Image source={{ uri: value }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          : <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>{camera ? 'Take a photo' : 'Choose a photo'}</Text>}
      </Pressable>
      {!!value && !busy && <Button label="Remove photo" plain onPress={() => { latest.current++; onChange(null); }} />}
      {!!error && <Text style={{ color: t.danger, fontSize: 14, marginTop: 6 }}>{error}</Text>}
    </View>
  );
}
