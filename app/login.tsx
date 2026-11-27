// Sign in or create an account, on the /api/auth/* routes (lib/auth.js) through
// useAuth() in lib/api.ts. Open it with router.push('/login') from any screen
// that needs a person; it goes back when they are in.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Field, Screen } from '@/components/ui';
import { useAuth } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (creating) await signUp(email, password, name.trim() || undefined);
      else await signIn(email, password);
      leave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={creating ? 'Create account' : 'Sign in'} scroll>
      {creating && <Field label="Name (optional)" value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry onSubmitEditing={submit} textContentType={creating ? 'newPassword' : 'password'} />
      {!!error && <Text accessibilityLiveRegion="polite" style={{ color: t.danger, fontSize: 15, marginBottom: 8 }}>{error}</Text>}
      <Button label={creating ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />
      <Button plain label={creating ? 'I already have an account' : 'Create an account'} onPress={() => { setCreating(!creating); setError(''); }} />
      <Button plain label="Cancel" onPress={leave} />
    </Screen>
  );
}
