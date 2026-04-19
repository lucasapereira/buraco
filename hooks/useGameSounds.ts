import { useRef } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

const mortoSrc = require('../assets/sounds/morto.wav');
const canastraSrc = require('../assets/sounds/canastra.wav');
const baterSrc = require('../assets/sounds/bater.wav');
const turnoSrc = require('../assets/sounds/turno.wav');

setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});

export function useGameSounds() {
  const morto = useAudioPlayer(mortoSrc);
  const canastra = useAudioPlayer(canastraSrc);
  const bater = useAudioPlayer(baterSrc);
  const turno = useAudioPlayer(turnoSrc);

  const lastPlayRefs = useRef({
    morto: 0,
    canastra: 0,
    bater: 0,
    turno: 0,
  });

  const playSound = (type: 'morto' | 'canastra' | 'bater' | 'turno') => {
    const now = Date.now();
    if (now - lastPlayRefs.current[type] < 1000) return;
    lastPlayRefs.current[type] = now;

    const player =
      type === 'morto' ? morto :
      type === 'canastra' ? canastra :
      type === 'bater' ? bater :
      turno;

    try {
      player.seekTo(0).then(() => player.play()).catch(() => player.play());
    } catch (e) {
      console.warn(`Erro ao tocar som ${type}:`, e);
    }
  };

  return { playSound };
}
