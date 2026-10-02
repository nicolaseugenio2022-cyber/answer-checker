import X from 'lucide-react-native/icons/x';
import ZoomIn from 'lucide-react-native/icons/zoom-in';
import ZoomOut from 'lucide-react-native/icons/zoom-out';
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

type ScanImageViewerProps = {
  uri: string;
  /** Width over height of the sheet, so the whole page is laid out before the picture loads. */
  aspectRatio: number;
  description: string;
  onClose: () => void;
  /** The picture could not be shown after all. */
  onError: () => void;
};

/** How much wider than the screen the sheet is drawn when enlarged. */
const ENLARGED = 2.5;

/**
 * The stored scan of one result, full screen on a dark background. It opens
 * with the whole sheet in view, never cropped; "Enlarge" draws it larger and
 * lets the Teacher scroll around it. The picture is only displayed: there is
 * no sharing, no saving to the gallery, and its file location is never shown.
 * Mount it only while it is open.
 */
export function ScanImageViewer({ uri, aspectRatio, description, onClose, onError }: ScanImageViewerProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [isEnlarged, setIsEnlarged] = useState(false);

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <View className="flex-1 bg-black" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="min-h-14 flex-row items-center justify-between gap-2 px-2">
          <ViewerButton icon={X} label="Close" onPress={onClose} />
          <ViewerButton
            icon={isEnlarged ? ZoomOut : ZoomIn}
            label={isEnlarged ? 'Fit to screen' : 'Enlarge'}
            showLabel
            onPress={() => setIsEnlarged((current) => !current)}
          />
        </View>

        {isEnlarged ? (
          // Two scroll directions: down the page, and across it.
          <ScrollView showsVerticalScrollIndicator={false}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Image
                source={{ uri }}
                accessibilityLabel={description}
                resizeMode="contain"
                onError={onError}
                style={{ width: window.width * ENLARGED, aspectRatio }}
              />
            </ScrollView>
          </ScrollView>
        ) : (
          <View className="flex-1 items-center justify-center px-2 pb-2">
            <Image
              source={{ uri }}
              accessibilityLabel={description}
              resizeMode="contain"
              onError={onError}
              style={{ width: '100%', height: '100%' }}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

type ViewerButtonProps = {
  icon: typeof X;
  label: string;
  showLabel?: boolean;
  onPress: () => void;
};

/** A 48dp control on the dark viewer. White on black in both themes, by design. */
function ViewerButton({ icon, label, showLabel = false, onPress }: ViewerButtonProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        'h-12 min-w-12 flex-row items-center justify-center gap-2 rounded-full px-3 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-white',
        isPressed && 'bg-white/20'
      )}>
      <Icon as={icon} size={22} className="text-white" />
      {showLabel && <Text className="text-sm font-medium text-white">{label}</Text>}
    </Pressable>
  );
}
