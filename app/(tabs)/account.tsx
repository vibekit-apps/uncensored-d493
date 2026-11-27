// The third tab: who is signed in, and their profile (photo, name, bio), kept
// by lib/profile.js through GET/POST /api/profile. Signing in is optional, so
// the app works without it; the sign-in screen is app/login.tsx. Keep a record
// per person only after wiring it to user.id in server.js (TEMPLATE.md, Accounts).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native';
import { Button, Card, Field, PhotoField, Row, Screen } from '@/components/ui';
import { api, useAuth } from '@/lib/api';
import { useTheme } from '@/lib/theme';

type Profile = { userId?: string; name: string; bio: string; photo: string | null };

export default function Account() {
  const t = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  return (
    <Screen title="Account" scroll>
      {user === undefined ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={t.accent} />
      ) : user ? (
        <>
          {/* One editor per signed-in person: another person (or signing out)
              throws it away with its loads, saves and photo picks, so nothing
              of theirs can land in the next person's form. */}
          <ProfileEditor key={user.id} userId={user.id} />
          <Card>
            <Row label="Email" right={user.email} />
          </Card>
          <Button label="Sign out" plain onPress={signOut} />
        </>
      ) : (
        <>
          <Card>
            <Text style={{ color: t.text, fontSize: 16 }}>Sign in to keep your things on every device.</Text>
          </Card>
          <Button label="Sign in" onPress={() => router.push('/login')} />
        </>
      )}
    </Screen>
  );
}

const SOMEONE_ELSE = 'You are signed in as someone else now. Reload to edit that profile.';

function ProfileEditor({ userId }: { userId: string }) {
  const t = useTheme();
  const { reload } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const alive = useRef(true);
  // Bumped on every edit, so a save's reply never wipes edits made while it ran.
  const edits = useRef(0);
  // Read by Save at once; the state above only redraws the button.
  const cropping = useRef(false);

  useEffect(() => {
    alive.current = true;
    api<Profile>('GET', '/api/profile').then(
      (p) => {
        if (!alive.current) return;
        // Another tab signed this browser in as someone else: never show or
        // edit their profile under this person's name.
        if (p.userId !== userId) setNote({ text: SOMEONE_ELSE, error: true });
        else setProfile(p);
      },
      (e) => { if (alive.current) setNote({ text: e.message, error: true }); },
    );
    return () => { alive.current = false; };
  }, []);

  const edit = (change: Partial<Profile>) => {
    edits.current++;
    setProfile((p) => (p ? { ...p, ...change } : p));
    setNote(null);
  };
  const onBusy = (busy: boolean) => {
    cropping.current = busy;
    setPhotoBusy(busy);
  };

  const save = async () => {
    if (!profile || saving || cropping.current) return;
    const version = edits.current;
    setSaving(true);
    setNote(null);
    try {
      // Named for this person, so the server refuses it (409) if the browser
      // has since signed in as someone else.
      const saved = await api<Profile>('POST', '/api/profile', { ...profile, userId });
      if (!alive.current) return;
      if (edits.current === version) {
        setProfile(saved);
        setNote({ text: 'Saved' });
      } else {
        setNote({ text: 'Your newest changes are not saved yet. Tap Save again.' });
      }
      reload().catch(() => {});
    } catch (e) {
      if (alive.current) setNote({ text: (e as Error).message, error: true });
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  return (
    <>
      {profile ? (
        <>
          <PhotoField label="Photo" square={256} value={profile.photo} onBusy={onBusy} onChange={(photo) => edit({ photo: photo ? photo.dataUrl : null })} />
          <Field label="Name" value={profile.name} onChangeText={(name) => edit({ name })} autoComplete="name" textContentType="name" />
          <Field label="Bio" value={profile.bio} onChangeText={(bio) => edit({ bio })} multiline style={{ minHeight: 88, textAlignVertical: 'top' }} />
          <Button label="Save" loading={saving || photoBusy} onPress={save} />
        </>
      ) : (
        !note && <ActivityIndicator style={{ marginVertical: 24 }} color={t.accent} />
      )}
      {!!note && <Text style={{ color: note.error ? t.danger : t.muted, fontSize: 14, marginVertical: 8 }}>{note.text}</Text>}
    </>
  );
}
