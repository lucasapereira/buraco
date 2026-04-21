/**
 * useGoogleAuth
 *
 * Vincula ou entra com conta Google.
 *
 * Cenários:
 * 1. Usuário anônimo com stats locais nunca vinculado → linkWithCredential
 *    (mantém uid atual + stats).
 * 2. Usuário anônimo tentando entrar numa conta Google que já tem perfil
 *    (ex.: reinstalou o app) → linkWithCredential falha com credential-already-in-use;
 *    aí fazemos signInWithCredential pro uid antigo e descartamos o anônimo.
 * 3. Login limpo com Google numa instalação nova sem stats.
 */

import {
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInAnonymously,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { auth } from '../config/firebase';
import { useProfileStore } from '../store/profileStore';
import { get as dbGet, ref } from 'firebase/database';
import { db } from '../config/firebase';
import { useStatsStore } from '../store/statsStore';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    throw new Error('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID não configurado no .env');
  }
  GoogleSignin.configure({
    webClientId,
    offlineAccess: false,
  });
  configured = true;
}

export type GoogleAuthResult =
  | { ok: true; linkedExisting: boolean; uid: string }
  | { ok: false; error: string };

/**
 * Faz login com Google. Se já tem uid anônimo, tenta vincular; se a conta Google
 * já está em uso por outro uid (reinstalação), troca pro uid antigo.
 */
export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  try {
    console.log('[google] start');
    ensureConfigured();
    console.log('[google] configured');
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    console.log('[google] playServices ok');
    // Cancela sessão antiga pro usuário poder escolher conta de novo se clicar
    try { await GoogleSignin.signOut(); } catch (_) {}
    const response: any = await GoogleSignin.signIn();
    console.log('[google] signIn response:', JSON.stringify(response).slice(0, 200));
    const idToken: string | null = response?.data?.idToken ?? response?.idToken ?? null;
    if (!idToken) {
      console.warn('[google] no idToken. response keys:', Object.keys(response ?? {}));
      return { ok: false, error: 'Falha ao obter token do Google (idToken vazio)' };
    }
    console.log('[google] idToken len:', idToken.length);

    const credential = GoogleAuthProvider.credential(idToken);
    const currentUser = auth.currentUser;
    console.log('[google] currentUser:', currentUser?.uid, 'anon:', currentUser?.isAnonymous);

    // Cenário A: sem usuário logado — signIn direto
    if (!currentUser) {
      console.log('[google] path A: signInWithCredential (no current user)');
      const result = await signInWithCredential(auth, credential);
      console.log('[google] path A ok, uid:', result.user.uid);
      await hydrateFromRemoteProfile(result.user.uid);
      return { ok: true, linkedExisting: true, uid: result.user.uid };
    }

    // Cenário B: anônimo — tenta vincular
    if (currentUser.isAnonymous) {
      console.log('[google] path B: linkWithCredential');
      try {
        const result = await linkWithCredential(currentUser, credential);
        console.log('[google] path B linked, uid:', result.user.uid);
        useProfileStore.setState({ myUid: result.user.uid });
        await useProfileStore.getState().syncProfileToFirebase();
        return { ok: true, linkedExisting: false, uid: result.user.uid };
      } catch (e: any) {
        console.warn('[google] link failed code=', e?.code, 'msg=', e?.message);
        if (e?.code === 'auth/credential-already-in-use' || e?.code === 'auth/email-already-in-use') {
          console.log('[google] path B fallback: signInWithCredential');
          const result = await signInWithCredential(auth, credential);
          console.log('[google] path B fallback ok, uid:', result.user.uid);
          await hydrateFromRemoteProfile(result.user.uid);
          return { ok: true, linkedExisting: true, uid: result.user.uid };
        }
        throw e;
      }
    }

    // Cenário C: já logado com Google — hidrata perfil (caso profile local esteja vazio)
    console.log('[google] path C: already linked — hydrating');
    await hydrateFromRemoteProfile(currentUser.uid);
    return { ok: true, linkedExisting: true, uid: currentUser.uid };
  } catch (e: any) {
    console.warn('[google] FAIL code=', e?.code, 'msg=', e?.message);
    if (e?.code === statusCodes.SIGN_IN_CANCELLED) return { ok: false, error: 'Login cancelado' };
    if (e?.code === statusCodes.IN_PROGRESS) return { ok: false, error: 'Já em andamento' };
    if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { ok: false, error: 'Google Play Services indisponível' };
    return { ok: false, error: `[${e?.code ?? 'erro'}] ${e?.message ?? 'Erro desconhecido'}` };
  }
}

export async function signOutGoogle() {
  try {
    await GoogleSignin.signOut();
  } catch (_) {}
}

/**
 * Desvincula Google: sai do Google, sai do Firebase, limpa profile local e volta
 * pra uma sessão anônima fresca. Os stats do perfil Google ficam salvos no
 * Firebase — logando de novo com Google, tudo é restaurado via hydrate.
 */
export async function unlinkGoogle() {
  try { await GoogleSignin.signOut(); } catch (_) {}
  try { await firebaseSignOut(auth); } catch (_) {}
  // Limpa profile local — usuário volta a ser "ninguém" até escolher nome ou logar de novo
  useProfileStore.setState({
    myUid: null,
    myUsername: null,
    myUsernameLower: null,
    joinedAt: 0,
    lastNameChangeAt: null,
    migratedFromLocal: false,
  });
  useStatsStore.setState({
    level: 1, totalXP: 0,
    matchesPlayed: 0, matchesWon: 0,
    totalCanastas: 0, totalCleanCanastas: 0, total500Canastas: 0, total1000Canastas: 0, totalDirtyCanastas: 0,
    totalBatidas: 0, biggestRoundScore: 0, biggestMatchDiff: 0, totalPointsEarned: 0,
    longestStreak: 0, longestWinStreak: 0,
    botMatchesPlayed: 0, botMatchesWon: 0, currentBotWinStreak: 0, longestBotWinStreak: 0, hardWins: 0,
    onlineMatchesPlayed: 0, onlineMatchesWon: 0, onlineRating: 1000,
    unlockedAchievements: [], recentMatches: [],
  });
  // Cria uma nova sessão anônima pra não ficar sem uid (Firebase exige auth pra quase tudo)
  try { await signInAnonymously(auth); } catch (_) {}
}

/** Puxa o perfil remoto do Firebase e hidrata o profileStore + statsStore. */
async function hydrateFromRemoteProfile(uid: string) {
  const snap = await dbGet(ref(db, `users/${uid}`));
  const profile = snap.val();
  if (!profile) {
    // Perfil ainda não existe — mantém stats locais e sincroniza depois
    useProfileStore.setState({ myUid: uid, migratedFromLocal: false });
    return;
  }
  // Restaura profile
  useProfileStore.setState({
    myUid: uid,
    myUsername: profile.displayName ?? null,
    myUsernameLower: profile.displayNameLower ?? null,
    joinedAt: profile.joinedAt ?? Date.now(),
    lastNameChangeAt: profile.lastNameChangeAt ?? null,
    migratedFromLocal: true,
  });
  // Restaura stats
  useStatsStore.setState({
    level: profile.level ?? 1,
    totalXP: profile.totalXP ?? 0,
    matchesPlayed: profile.matchesPlayed ?? 0,
    matchesWon: profile.matchesWon ?? 0,
    totalCanastas: profile.totalCanastas ?? 0,
    totalCleanCanastas: profile.totalCleanCanastas ?? 0,
    total500Canastas: profile.total500Canastas ?? 0,
    total1000Canastas: profile.total1000Canastas ?? 0,
    totalDirtyCanastas: profile.totalDirtyCanastas ?? 0,
    totalBatidas: profile.totalBatidas ?? 0,
    biggestRoundScore: profile.biggestRoundScore ?? 0,
    biggestMatchDiff: profile.biggestMatchDiff ?? 0,
    totalPointsEarned: profile.totalPointsEarned ?? 0,
    longestStreak: profile.longestStreak ?? 0,
    longestWinStreak: profile.longestWinStreak ?? 0,
    botMatchesPlayed: profile.botMatchesPlayed ?? 0,
    botMatchesWon: profile.botMatchesWon ?? 0,
    currentBotWinStreak: profile.currentBotWinStreak ?? 0,
    longestBotWinStreak: profile.longestBotWinStreak ?? 0,
    hardWins: profile.hardWins ?? 0,
    onlineMatchesPlayed: profile.onlineMatchesPlayed ?? 0,
    onlineMatchesWon: profile.onlineMatchesWon ?? 0,
    onlineRating: profile.onlineRating ?? 1000,
    unlockedAchievements: profile.unlockedAchievements ?? [],
    recentMatches: profile.recentMatches ?? [],
  });
}
