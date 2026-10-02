import type { PropsWithChildren } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ModalCardProps = PropsWithChildren<{
  /** Android back button. Must be the safe choice (cancel). */
  onRequestClose: () => void;
  onShow?: () => void;
  /**
   * `top` keeps the card in the upper part of the screen, where the keyboard
   * cannot cover it; use it for anything with a text field.
   */
  position?: 'center' | 'top';
}>;

/**
 * A dialog card over a dimmed screen, built on React Native's Modal so it
 * covers the floating tab bar and handles the Android back button. A tap
 * outside the card does nothing, so a stray touch cannot discard typed text.
 * Mount it only while it is open.
 */
export function ModalCard({ children, onRequestClose, onShow, position = 'center' }: ModalCardProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
      onShow={onShow}>
      <View className="flex-1 bg-black/60">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: position === 'top' ? 'flex-start' : 'center',
            paddingTop: insets.top + (position === 'top' ? 64 : 16),
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 16,
          }}>
          <View
            accessibilityViewIsModal
            className="w-full max-w-md gap-4 self-center rounded-xl border border-border bg-popover p-5">
            {children}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
