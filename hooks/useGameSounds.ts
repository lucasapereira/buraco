import { useEffect, useState, useRef } from 'react';
import { Audio } from 'expo-av';

export function useGameSounds() {
  const [mortoSound, setMortoSound] = useState<Audio.Sound | null>(null);
  const [canastraSound, setCanastraSound] = useState<Audio.Sound | null>(null);
  const [baterSound, setBaterSound] = useState<Audio.Sound | null>(null);
  const [turnoSound, setTurnoSound] = useState<Audio.Sound | null>(null);

  // Use refs to prevent spamming sounds too frequently
  const lastPlayRefs = useRef({
    morto: 0,
    canastra: 0,
    bater: 0,
    turno: 0,
  });

  useEffect(() => {
    let _morto: Audio.Sound | null = null;
    let _canastra: Audio.Sound | null = null;
    let _bater: Audio.Sound | null = null;
    let _turno: Audio.Sound | null = null;
    let mounted = true;

    async function loadSounds() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
        });

        const { sound: mSound } = await Audio.Sound.createAsync(
          require('../assets/sounds/morto.mp3')
        );
        _morto = mSound;
        if (mounted) setMortoSound(mSound);

        const { sound: cSound } = await Audio.Sound.createAsync(
          require('../assets/sounds/canastra.mp3')
        );
        _canastra = cSound;
        if (mounted) setCanastraSound(cSound);

        const { sound: bSound } = await Audio.Sound.createAsync(
          require('../assets/sounds/bater.mp3')
        );
        _bater = bSound;
        if (mounted) setBaterSound(bSound);

        const { sound: tSound } = await Audio.Sound.createAsync(
          require('../assets/sounds/turno.mp3')
        );
        _turno = tSound;
        if (mounted) setTurnoSound(tSound);
      } catch (e) {
        console.warn('Erro ao carregar os sons:', e);
      }
    }

    loadSounds();

    return () => {
      mounted = false;
      const sounds = [_morto, _canastra, _bater, _turno];
      setTimeout(() => {
        sounds.forEach(s => s?.unloadAsync().catch(() => {}));
      }, 200);
    };
  }, []);

  const playSound = async (type: 'morto' | 'canastra' | 'bater' | 'turno') => {
    const now = Date.now();
    // Debounce de 1 segundo para evitar tocar igual metralhadora
    if (now - lastPlayRefs.current[type] < 1000) return;
    
    lastPlayRefs.current[type] = now;

    try {
      if (type === 'morto') await mortoSound?.replayAsync();
      if (type === 'canastra') await canastraSound?.replayAsync();
      if (type === 'bater') await baterSound?.replayAsync();
      if (type === 'turno') await turnoSound?.replayAsync();
    } catch (e) {
      console.warn(`Erro ao tocar som ${type}:`, e);
    }
  };

  return { playSound };
}
