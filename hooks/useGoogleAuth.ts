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

import { i18n } from '../locales';
import {
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInAnonymously,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { auth, db } from '../config/firebase';
import { useProfileStore, UserProfile } from '../store/profileStore';
import { get as dbGet, ref } from 'firebase/database';
import { INITIAL_STATS, SYNCED_STATS_KEYS, useStatsStore } from '../store/statsStore';

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
      return { ok: false, error: i18n.t('online.googleIdTokenEmpty') };
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
        // Vincular promove anônimo → Google mantendo o mesmo uid e stats locais.
        // Libera sync ANTES de syncProfileToFirebase senão o próprio call cai
        // no skip do auto-sync (não é o caso aqui pois é chamada direta, mas
        // qualquer recordRound disparado em paralelo precisa do sync liberado).
        useProfileStore.setState({ myUid: result.user.uid, syncEnabled: true });
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
    if (e?.code === statusCodes.SIGN_IN_CANCELLED) return { ok: false, error: i18n.t('online.loginCanceled') };
    if (e?.code === statusCodes.IN_PROGRESS) return { ok: false, error: i18n.t('online.googleAlreadyInProgress') };
    if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { ok: false, error: i18n.t('online.googlePlayServicesUnavailable') };
    return { ok: false, error: i18n.t('online.googleUnknownError', { code: e?.code ?? 'error', msg: e?.message ?? i18n.t('online.errorUnknown') }) };
  }
}

export async function signOutGoogle() {
  try {
    await GoogleSignin.signOut();
  } catch (_) {}
}

export type BootstrapResult = 'already' | 'google' | 'anon' | 'needs-relogin';

/**
 * Garante uma sessão Firebase no startup. Necessário porque reinstalar o app
 * apaga o token de auth (guardado no AsyncStorage) — sem isso toda leitura do
 * Firebase (ranking, perfis) cai em permission_denied.
 *
 * Ordem segura:
 * 1. Já tem auth → hidrata stats do Firebase pra qualquer campo que tenha
 *    saído do statsStore local (ex.: bug do hydrate antigo perdendo
 *    expertWins/currentStreak). Esse hydrate destrava o auto-sync, então
 *    se rodar antes da primeira partida pós-update, recupera os dados.
 * 2. Tenta restaurar o Google SEM interação (a conta dele já está no aparelho).
 * 3. Sem Google e SEM perfil local → anon (usuário novo, sem risco).
 * 4. Sem Google MAS com perfil local → NÃO cria anon (criaria uid novo e
 *    orfanaria o perfil Google). Sinaliza que precisa relogar.
 */
export async function bootstrapAuth(): Promise<BootstrapResult> {
  if (auth.currentUser) {
    // Hidrata mesmo aqui — sem isso, jogador que recebe update (sem reinstalar)
    // nunca recupera campos perdidos por bugs antigos do hydrate.
    // Se falhar (offline, regra Firebase, timeout): syncEnabled fica false,
    // gameplay continua mas auto-sync NÃO dispara — senão dbSet escreveria os
    // stats locais (possivelmente zerados) por cima do Firebase. Próximo
    // startup com rede tenta de novo.
    await hydrateFromRemoteProfile(auth.currentUser.uid).catch(() => {});
    return 'already';
  }

  try {
    ensureConfigured();
    const res: any = await GoogleSignin.signInSilently();
    const idToken: string | null = res?.data?.idToken ?? res?.idToken ?? null;
    if (idToken) {
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      await hydrateFromRemoteProfile(result.user.uid);
      return 'google';
    }
  } catch (_) {
    // Sem credencial salva / não logado no Google no device → fallback abaixo.
  }

  const localUid = useProfileStore.getState().myUid;
  if (!localUid) {
    try {
      await signInAnonymously(auth);
      // Usuário novo sem perfil — libera sync pra primeira partida poder gravar.
      useProfileStore.setState({ syncEnabled: true });
      return 'anon';
    } catch (_) {}
  }
  return 'needs-relogin';
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
  // Zera TUDO menos o playerId (UUID local) — usar INITIAL_STATS garante
  // que campos novos no statsStore também são limpos sem ter que vir aqui.
  useStatsStore.setState(INITIAL_STATS);
  // Cria uma nova sessão anônima pra não ficar sem uid (Firebase exige auth pra quase tudo)
  try { await signInAnonymously(auth); } catch (_) {}
}

/**
 * Puxa o perfil remoto do Firebase e hidrata o profileStore + statsStore.
 * Itera SYNCED_STATS_KEYS pra restaurar todo stat sincronizado — sem isso o
 * cunhado reinstala o app e perde campos não-listados (foi assim que sumiram
 * `expertWins`/`currentStreak`/`lastDailyRewardDate` antes).
 */
async function hydrateFromRemoteProfile(uid: string) {
  const snap = await dbGet(ref(db, `users/${uid}`));
  const profile = snap.val() as UserProfile | null;
  if (!profile) {
    // Perfil ainda não existe — mantém stats locais e libera sync pra
    // primeira partida gravar (jogador novo, snapshot local é o estado certo).
    useProfileStore.setState({ myUid: uid, migratedFromLocal: false, syncEnabled: true });
    return;
  }
  useProfileStore.setState({
    myUid: uid,
    myUsername: profile.displayName ?? null,
    myUsernameLower: profile.displayNameLower ?? null,
    joinedAt: profile.joinedAt ?? Date.now(),
    lastNameChangeAt: profile.lastNameChangeAt ?? null,
    migratedFromLocal: true,
  });
  const patch: Record<string, unknown> = {};
  for (const k of SYNCED_STATS_KEYS) {
    const v = (profile as any)[k];
    if (v !== undefined && v !== null) patch[k] = v;
  }
  // `lastDailyRewardDate` é monotônico: nunca anda pra trás. Last-writer-wins
  // aqui clobbava o valor local (mais novo) com um remoto vazio/antigo — o app
  // re-persistia o ruim e o auto-sync o reempurrava pro Firebase, então o modal
  // de prêmio diário reabria a CADA boot (e refarmava XP). Só aplica o remoto
  // se a data dele for estritamente mais nova; senão mantém o local. O streak
  // viaja junto com a data vencedora (um reset legítimo p/ 1 carrega data nova).
  {
    const localDate = useStatsStore.getState().lastDailyRewardDate ?? '';
    const remoteDate = (profile as any).lastDailyRewardDate ?? '';
    if (!(remoteDate > localDate)) {
      delete patch.lastDailyRewardDate;
      delete patch.currentStreak;
    }
  }
  useStatsStore.setState(patch as any);
  // Hydrate concluído — libera o auto-sync. A partir de agora qualquer mudança
  // local sobe pro Firebase com confiança que não vai sobrescrever campo bom.
  useProfileStore.setState({ syncEnabled: true });
}
