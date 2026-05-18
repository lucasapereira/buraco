import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBackground } from './ScreenBackground';
import { GameColors, Radius } from '../constants/colors';
import { useProfileStore } from '../store/profileStore';
import { useOnlineStore } from '../store/onlineStore';
import { signInWithGoogle } from '../hooks/useGoogleAuth';

/**
 * Tela bloqueante de primeiro acesso. Só é renderizada (pelo layout das tabs)
 * enquanto o jogador não tem um username reservado no Firebase. Garante que
 * todo mundo que joga aparece no ranking.
 *
 * - Caminho normal: nome + auth anônima → claimUsername → migra stats offline.
 * - Google é opcional (recupera perfil após reinstalar).
 * - Sem internet: NÃO trava o jogo — deixa jogar offline e re-pergunta no
 *   próximo launch (myUsername continua nulo).
 * - "Nome em uso" continua bloqueando, com retry.
 */
export function OnboardingGate() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [offlineEscape, setOfflineEscape] = useState(false);

  const finishInto = async () => {
    await useProfileStore.getState().migrateLocalStatsIfNeeded();
    router.replace('/(tabs)/ranking' as any);
  };

  const isNameTakenError = (msg: string | null | undefined) =>
    !!msg && msg.toLowerCase().includes('já está em uso');

  const handleContinue = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Nome muito curto (mínimo 2 letras)');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await useOnlineStore.getState().ensureAuth();
      await useProfileStore.getState().claimUsername(trimmed);
      useOnlineStore.getState().setDisplayName(trimmed);
      await finishInto();
    } catch (e: any) {
      const claimErr = useProfileStore.getState().claimError;
      if (isNameTakenError(claimErr) || isNameTakenError(e?.message)) {
        setError(claimErr ?? 'Esse nome já está em uso. Escolha outro.');
      } else {
        // Provável falta de conexão — não trava o jogo offline.
        setError('Sem conexão para registrar o nome agora.');
        setOfflineEscape(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      await useOnlineStore.getState().ensureAuth();
      const res = await signInWithGoogle();
      if (!res.ok) {
        if (res.error !== 'Login cancelado') setError(res.error);
        return;
      }
      const { myUsername } = useProfileStore.getState();
      if (myUsername) {
        // Perfil antigo recuperado — entra direto.
        useOnlineStore.getState().setDisplayName(myUsername);
        await finishInto();
      } else {
        // Logou no Google mas é conta nova: ainda precisa escolher um nome
        // (o claim a seguir fica vinculado ao uid do Google).
        setError('Conta Google conectada! Agora escolha um nome para jogar.');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Falha no login com Google');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handlePlayOffline = () => {
    // Não grava myUsername — o gate reaparece no próximo launch.
    router.replace('/(tabs)' as any);
  };

  const anyBusy = busy || googleBusy;

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.emoji}>🃏</Text>
          <Text style={styles.title}>Bem-vindo ao Buraco!</Text>
          <Text style={styles.subtitle}>
            Escolha um nome para entrar no ranking e jogar com a família
          </Text>

          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={(t) => { setName(t); if (error) setError(null); }}
            placeholder="Seu nome"
            placeholderTextColor={GameColors.text.faint}
            maxLength={16}
            autoFocus
            editable={!anyBusy}
            returnKeyType="done"
            onSubmitEditing={handleContinue}
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, anyBusy && styles.btnDisabled]}
            onPress={handleContinue}
            disabled={anyBusy}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator color={GameColors.text.onGold} />
              : <Text style={styles.primaryBtnText}>ENTRAR →</Text>}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.googleBtn, anyBusy && styles.btnDisabled]}
            onPress={handleGoogle}
            disabled={anyBusy}
            activeOpacity={0.85}
          >
            {googleBusy
              ? <ActivityIndicator color="#0A1C30" />
              : <Text style={styles.googleBtnText}>🔐 Entrar com Google</Text>}
          </TouchableOpacity>
          <Text style={styles.googleHint}>
            Recupera seu perfil mesmo após reinstalar o app
          </Text>

          {offlineEscape && (
            <TouchableOpacity
              style={styles.offlineLink}
              onPress={handlePlayOffline}
              activeOpacity={0.7}
            >
              <Text style={styles.offlineLinkText}>
                Jogar offline por enquanto
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  emoji: { fontSize: 56, marginBottom: 12 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: GameColors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: GameColors.text.secondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 28,
    lineHeight: 20,
  },
  nameInput: {
    width: '100%',
    backgroundColor: GameColors.surface.mid,
    borderWidth: 1,
    borderColor: GameColors.surface.border,
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 18,
    color: GameColors.text.primary,
    textAlign: 'center',
  },
  errorText: {
    color: GameColors.dangerSoft,
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: GameColors.gold,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryBtnText: {
    color: GameColors.text.onGold,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  btnDisabled: { opacity: 0.55 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 22,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: GameColors.surface.border },
  dividerText: { color: GameColors.text.muted, marginHorizontal: 12, fontSize: 13 },
  googleBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  googleBtnText: { color: '#0A1C30', fontSize: 16, fontWeight: '700' },
  googleHint: {
    color: GameColors.text.muted,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  offlineLink: { marginTop: 26, padding: 8 },
  offlineLinkText: {
    color: GameColors.text.secondary,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
