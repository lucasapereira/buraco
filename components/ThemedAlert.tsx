/**
 * ThemedAlert — substituto imperativo do Alert.alert nativo com visual do jogo.
 *
 * Uso:
 *   import { showAlert } from '@/components/ThemedAlert';
 *   showAlert('Título', 'Mensagem opcional', [
 *     { text: 'Cancelar', style: 'cancel' },
 *     { text: 'Confirmar', style: 'destructive', onPress: () => ... },
 *   ]);
 *
 * A API espelha Alert.alert(title, message?, buttons?) para trocas 1:1.
 * Sem buttons, mostra um "OK" padrão.
 *
 * <ThemedAlertHost /> precisa estar montado uma vez na raiz (_layout.tsx).
 */

import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { create } from 'zustand';
import { Elevation, GameColors, Radius } from '../constants/colors';

type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface AlertButton {
  text: string;
  style?: AlertButtonStyle;
  onPress?: () => void;
}

interface AlertPayload {
  title: string;
  message?: string;
  buttons: AlertButton[];
}

interface AlertState {
  visible: boolean;
  payload: AlertPayload | null;
  show: (p: AlertPayload) => void;
  hide: () => void;
}

const useAlertStore = create<AlertState>((set) => ({
  visible: false,
  payload: null,
  show: (payload) => set({ visible: true, payload }),
  hide: () => set({ visible: false }),
}));

export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[]
) {
  const finalButtons: AlertButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' }];
  useAlertStore.getState().show({ title, message, buttons: finalButtons });
}

export const ThemedAlertHost: React.FC = () => {
  const visible = useAlertStore((s) => s.visible);
  const payload = useAlertStore((s) => s.payload);
  const hide = useAlertStore((s) => s.hide);

  const handlePress = (btn: AlertButton) => {
    hide();
    btn.onPress?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        // Back button no Android: dispara o botão "cancel" se existir, senão só fecha.
        const cancelBtn = payload?.buttons.find((b) => b.style === 'cancel');
        if (cancelBtn) handlePress(cancelBtn);
        else hide();
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.box}>
          <Text style={styles.title}>{payload?.title}</Text>
          {payload?.message ? <Text style={styles.message}>{payload.message}</Text> : null}
          <View
            style={[
              styles.btnRow,
              (payload?.buttons.length ?? 0) > 2 && styles.btnRowColumn,
            ]}
          >
            {payload?.buttons.map((btn, i) => {
              const isDestructive = btn.style === 'destructive';
              const isCancel = btn.style === 'cancel';
              const isPrimary = !isDestructive && !isCancel;
              return (
                <TouchableOpacity
                  key={`${btn.text}-${i}`}
                  onPress={() => handlePress(btn)}
                  activeOpacity={0.85}
                  style={[
                    styles.btn,
                    isPrimary && styles.btnPrimary,
                    isCancel && styles.btnCancel,
                    isDestructive && styles.btnDestructive,
                  ]}
                >
                  <Text
                    style={[
                      styles.btnText,
                      isPrimary && styles.btnTextPrimary,
                      isCancel && styles.btnTextCancel,
                      isDestructive && styles.btnTextDestructive,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: GameColors.overlay.modal,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: GameColors.bg.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 22,
    borderWidth: 2,
    borderColor: GameColors.gold,
    ...Elevation.modal,
  },
  title: {
    color: GameColors.gold,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  message: {
    color: GameColors.text.secondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 18,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 4,
  },
  btnRowColumn: {
    flexDirection: 'column',
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderWidth: 1,
  },
  btnPrimary: {
    backgroundColor: GameColors.gold,
    borderColor: GameColors.gold,
    ...Elevation.goldGlow,
  },
  btnCancel: {
    backgroundColor: 'transparent',
    borderColor: GameColors.surface.border,
  },
  btnDestructive: {
    backgroundColor: GameColors.danger,
    borderColor: GameColors.danger,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  btnTextPrimary: {
    color: GameColors.text.onGold,
  },
  btnTextCancel: {
    color: GameColors.text.secondary,
  },
  btnTextDestructive: {
    color: '#FFFFFF',
  },
});
