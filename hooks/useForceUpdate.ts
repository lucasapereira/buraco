import { onValue, ref } from 'firebase/database';
import { useEffect, useState } from 'react';
import { db } from '../config/firebase';
import Constants from 'expo-constants';

const CURRENT_VERSION_CODE: number =
  (Constants.expoConfig?.android?.versionCode as number | undefined) ?? 0;

export function useForceUpdate(): { needsUpdate: boolean; checking: boolean } {
  const [checking, setChecking] = useState(true);
  const [needsUpdate, setNeedsUpdate] = useState(false);

  useEffect(() => {
    // Timeout de segurança: se o Firebase não responder em 4s, libera o app
    const timeout = setTimeout(() => setChecking(false), 4000);

    const configRef = ref(db, 'config/minVersionCode');
    const unsub = onValue(configRef, (snap) => {
      clearTimeout(timeout);
      const minVersionCode: number = snap.val() ?? 0;
      setNeedsUpdate(CURRENT_VERSION_CODE < minVersionCode);
      setChecking(false);
    }, () => {
      clearTimeout(timeout);
      setChecking(false);
    });

    return () => { clearTimeout(timeout); unsub(); };
  }, []);

  return { needsUpdate, checking };
}
