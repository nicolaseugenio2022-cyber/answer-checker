import { CameraView, useCameraPermissions } from 'expo-camera';
import Camera from 'lucide-react-native/icons/camera';
import Flashlight from 'lucide-react-native/icons/flashlight';
import FlashlightOff from 'lucide-react-native/icons/flashlight-off';
import X from 'lucide-react-native/icons/x';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

type CameraCaptureDialogProps = {
  /** Who and what the photo is for, shown so the wrong student is not scanned. */
  studentName: string;
  answerKeyName: string;
  /** The photo was taken. `uri` is a file in the app's cache, not in the gallery. */
  onCaptured: (uri: string) => void;
  onCancel: () => void;
};

/**
 * The camera step: asks for the camera only here, shows a portrait guide for
 * the sheet, and takes one still photo when the Teacher presses the button.
 * The photo goes to the app's cache; nothing is written to the gallery.
 * Mount it only while it is open.
 */
export function CameraCaptureDialog({
  studentName,
  answerKeyName,
  onCaptured,
  onCancel,
}: CameraCaptureDialogProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [isReady, setIsReady] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  // State updates are not immediate; this stops a second press in the same frame.
  const isBusy = useRef(false);

  // Coming back from the system settings: the permission may have changed there.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission]);

  async function capture() {
    if (!camera.current || !isReady || isBusy.current) return;
    isBusy.current = true;
    setIsCapturing(true);
    setCaptureFailed(false);
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 0.9,
        exif: false,
        shutterSound: false,
      });
      onCaptured(photo.uri);
    } catch (error) {
      console.error(error);
      setCaptureFailed(true);
      isBusy.current = false;
      setIsCapturing(false);
    }
  }

  const header = (
    <View
      className="absolute left-0 right-0 flex-row items-center gap-2 px-2"
      style={{ top: insets.top + 4 }}>
      <RoundButton icon={X} label="Cancel scanning" onPress={onCancel} />
      <View className="flex-1 rounded-lg bg-black/55 px-3 py-1.5">
        <Text numberOfLines={1} className="text-sm font-semibold text-white">
          {studentName}
        </Text>
        <Text numberOfLines={1} className="text-xs text-white/80">
          {answerKeyName}
        </Text>
      </View>
      {permission?.granted && !isUnavailable && (
        <RoundButton
          icon={isTorchOn ? Flashlight : FlashlightOff}
          label={isTorchOn ? 'Turn the flash off' : 'Turn the flash on'}
          isOn={isTorchOn}
          onPress={() => setIsTorchOn((on) => !on)}
        />
      )}
    </View>
  );

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}>
      <View className="flex-1 bg-black">
        {permission === null ? (
          <Centered>
            <ActivityIndicator className="text-white" />
          </Centered>
        ) : !permission.granted ? (
          <Centered>
            <Text role="heading" aria-level="2" className="text-center text-lg font-semibold text-white">
              {permission.canAskAgain ? 'Allow the camera to scan' : 'The camera is turned off for this app'}
            </Text>
            <Text className="text-center text-[15px] leading-[22px] text-white/80">
              {permission.canAskAgain
                ? 'The camera is used only to photograph answer sheets. Photos stay on this phone and are not added to your gallery.'
                : 'Camera access was denied. Turn it on for Answer Checker in the phone settings, then come back.'}
            </Text>
            {permission.canAskAgain ? (
              <Button className="h-12 self-stretch" onPress={() => void requestPermission()}>
                <Text>Allow camera</Text>
              </Button>
            ) : (
              <Button className="h-12 self-stretch" onPress={() => void Linking.openSettings()}>
                <Text>Open settings</Text>
              </Button>
            )}
          </Centered>
        ) : isUnavailable ? (
          <Centered>
            <Text role="heading" aria-level="2" className="text-center text-lg font-semibold text-white">
              The camera could not be started
            </Text>
            <Text className="text-center text-[15px] leading-[22px] text-white/80">
              Close other apps that use the camera, then try again.
            </Text>
            <Button
              className="h-12 self-stretch"
              onPress={() => {
                setIsUnavailable(false);
                setIsReady(false);
              }}>
              <Text>Try again</Text>
            </Button>
          </Centered>
        ) : (
          <>
            <CameraView
              ref={camera}
              style={{ flex: 1 }}
              facing="back"
              enableTorch={isTorchOn}
              onCameraReady={() => setIsReady(true)}
              onMountError={() => setIsUnavailable(true)}
            />

            {/* The guide: the sheet's portrait shape, so the whole page is framed. */}
            <View
              pointerEvents="none"
              className="absolute left-0 right-0 items-center justify-center px-6"
              style={{ top: insets.top + 64, bottom: insets.bottom + 132 }}>
              <View
                className="max-h-full w-full rounded-md border-2 border-white/90"
                style={{ aspectRatio: 210 / 297 }}
              />
            </View>

            <View
              className="absolute left-0 right-0 items-center gap-3 px-4"
              style={{ bottom: insets.bottom + 20 }}>
              <View className="rounded-lg bg-black/55 px-3 py-1.5">
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-center text-sm leading-5 text-white">
                  {captureFailed
                    ? 'The photo could not be taken. Try again.'
                    : 'Fit the whole sheet in the frame, with all four corner squares visible.'}
                </Text>
              </View>
              <ShutterButton disabled={!isReady || isCapturing} isBusy={isCapturing} onPress={capture} />
            </View>
          </>
        )}
        {header}
      </View>
    </Modal>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center gap-4 px-8">{children}</View>;
}

type RoundButtonProps = {
  icon: typeof X;
  label: string;
  isOn?: boolean;
  onPress: () => void;
};

/** A 48dp control over the camera picture. */
function RoundButton({ icon, label, isOn = false, onPress }: RoundButtonProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isOn }}
      className={cn(
        'h-12 w-12 items-center justify-center rounded-full',
        isOn ? 'bg-primary' : 'bg-black/55',
        isPressed && 'opacity-70'
      )}>
      <Icon as={icon} size={22} className={isOn ? 'text-primary-foreground' : 'text-white'} />
    </Pressable>
  );
}

type ShutterButtonProps = { disabled: boolean; isBusy: boolean; onPress: () => void };

function ShutterButton({ disabled, isBusy, onPress }: ShutterButtonProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Take the photo"
      accessibilityState={{ disabled, busy: isBusy }}
      className={cn(
        'h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white bg-primary',
        isPressed && 'opacity-80',
        disabled && 'opacity-50'
      )}>
      {isBusy ? (
        <ActivityIndicator className="text-primary-foreground" />
      ) : (
        <Icon as={Camera} size={30} className="text-primary-foreground" />
      )}
    </Pressable>
  );
}
