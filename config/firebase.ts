/**
 * Firebase configuration
 *
 * Preencha os campos abaixo com os valores do seu projeto Firebase.
 * Veja as instruções no final deste arquivo.
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

/**
 * Preencha com os valores do seu projeto Firebase.
 * Veja as instruções no final deste arquivo.
 */
const firebaseConfig = {
  apiKey:            'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain:        'buraco-family.firebaseapp.com',
  databaseURL:       'EXPO_PUBLIC_FIREBASE_DATABASE_URL',
  projectId:         'buraco-family',
  storageBucket:     'buraco-family.firebasestorage.app',
  messagingSenderId: 'EXPO_PUBLIC_MESSAGING_SENDER_ID',
  appId:             '1:EXPO_PUBLIC_MESSAGING_SENDER_ID:web:5b5b301cc15dcff4f90623',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
