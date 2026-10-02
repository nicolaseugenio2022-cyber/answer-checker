import { useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import Camera from 'lucide-react-native/icons/camera';
import Check from 'lucide-react-native/icons/check';
import Eraser from 'lucide-react-native/icons/eraser';
import ScanLine from 'lucide-react-native/icons/scan-line';
import Trash from 'lucide-react-native/icons/trash';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  View,
} from 'react-native';

import { ModalCard } from '@/core/presentation/components/modal-card';
import { Notice, type NoticeMessage } from '@/core/presentation/components/notice';
import { Screen } from '@/core/presentation/components/screen';
import { Pending, Skeleton } from '@/core/presentation/components/skeleton';
import { useLoadingPhase } from '@/core/presentation/hooks/use-loading-phase';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Input } from '@/core/presentation/components/ui/input';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { DemoDataSection } from '@/features/demo-data/presentation/demo-data-section';
import { DiagnosticsSection } from '@/features/settings/presentation/diagnostics-section';
import { InvalidTeacherNameError } from '@/features/settings/application/settings-use-cases';
import {
  DELETE_ALL_PHRASE,
  TEACHER_NAME_MAX_LENGTH,
  cameraPermissionState,
  describeVersion,
  formatBytes,
  isDeleteAllPhrase,
  type Appearance,
  type CameraPermissionState,
  type StorageSummary,
} from '@/features/settings/domain/settings';
import { usePreferences } from '@/features/settings/presentation/preferences-context';
import { useSettingsUseCases } from '@/features/settings/presentation/settings-use-cases-context';
import { SlowLoadingSection } from '@/features/settings/presentation/slow-loading-section';

const APPEARANCE_OPTIONS: { id: Appearance; name: string; detail: string }[] = [
  { id: 'system', name: 'System', detail: 'Follows the phone and changes with it' },
  { id: 'light', name: 'Light', detail: 'Always light' },
  { id: 'dark', name: 'Dark', detail: 'Always dark' },
];

const CAMERA_STATES: Record<CameraPermissionState, { label: string; detail: string }> = {
  NOT_REQUESTED: {
    label: 'Not requested yet',
    detail: 'The phone asks the first time you open the camera in Scan.',
  },
  ALLOWED: { label: 'Allowed', detail: 'Scanning can use the camera.' },
  DENIED: {
    label: 'Denied',
    detail: 'The phone asks again the next time you open the camera in Scan.',
  },
  DENIED_PERMANENTLY: {
    label: 'Denied',
    detail:
      'The phone no longer asks. Allow the camera for Answer Checker in the system settings to scan.',
  },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text variant="h4" aria-level="2" className="text-base">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View className={cn('gap-3 rounded-lg border border-border bg-card p-4', className)}>
      {children}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} className="flex-row gap-3">
      <Text className="flex-1 text-sm leading-5 text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium leading-5">{value}</Text>
    </View>
  );
}

type OptionRowProps = {
  name: string;
  detail: string;
  isSelected: boolean;
  isFirst: boolean;
  onPress: () => void;
};

/** One of the three appearance choices. The chosen one carries a check, not only a color. */
function OptionRow({ name, detail, isSelected, isFirst, onPress }: OptionRowProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      role="radio"
      aria-checked={isSelected}
      accessibilityLabel={`${name}. ${detail}`}
      className={cn(
        'min-h-14 flex-row items-center gap-3 px-4 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        !isFirst && 'border-t border-border',
        isSelected && 'bg-primary/10',
        isPressed && 'bg-secondary'
      )}>
      <View className="flex-1">
        <Text className={cn('text-[15px] leading-[22px]', isSelected ? 'font-semibold' : 'font-medium')}>
          {name}
        </Text>
        <Text className="text-[13px] leading-[18px] text-muted-foreground">{detail}</Text>
      </View>
      <View className="h-6 w-6 items-center justify-center">
        {isSelected && <Icon as={Check} size={20} strokeWidth={3} className="text-primary" />}
      </View>
    </Pressable>
  );
}

/** Shows what the phone says about the camera. It reads the status and never asks for permission. */
function CameraPermissionCard({ onOpenScan }: { onOpenScan: () => void }) {
  const [permission, , getPermission] = useCameraPermissions();

  // The Teacher may change it in the system settings and come back.
  useFocusEffect(
    useCallback(() => {
      void getPermission();
    }, [getPermission])
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission]);

  if (!permission) {
    return (
      <Card>
        <Text className="text-sm text-muted-foreground">Checking the camera permission.</Text>
      </Card>
    );
  }

  const state = cameraPermissionState({
    status: permission.granted ? 'granted' : permission.status === 'denied' ? 'denied' : 'undetermined',
    canAskAgain: permission.canAskAgain,
  });
  const { label, detail } = CAMERA_STATES[state];

  return (
    <Card>
      <View accessible accessibilityLabel={`Camera permission: ${label}. ${detail}`} className="gap-1">
        <View className="flex-row items-center gap-2">
          <Icon as={Camera} size={18} className="text-muted-foreground" />
          <Text className="text-[15px] font-semibold leading-[22px]">{label}</Text>
        </View>
        <Text className="text-sm leading-5 text-muted-foreground">{detail}</Text>
      </View>
      <Text className="text-sm leading-5">
        The camera is used only to photograph answer sheets. Photos stay on this phone. The app
        asks for no microphone, location, contacts, or gallery access.
      </Text>
      {state === 'DENIED_PERMANENTLY' ? (
        <Button variant="outline" className="h-12 self-start" onPress={() => void Linking.openSettings()}>
          <Text>Open system settings</Text>
        </Button>
      ) : (
        <Button variant="outline" className="h-12 self-start" onPress={onOpenScan}>
          <Icon as={ScanLine} size={16} />
          <Text>Open Scan</Text>
        </Button>
      )}
    </Card>
  );
}

const sizeOf = (bytes: number | null) => (bytes === null ? 'Not available' : formatBytes(bytes));

/**
 * Settings: appearance, the optional display name, the camera permission,
 * what is stored on this device, cleanup, and the permanent deletion of all
 * academic data. Everything here is local; nothing is sent anywhere. It calls
 * use cases only: no SQL and no file paths.
 */
export function SettingsScreen() {
  const router = useRouter();
  const settings = useSettingsUseCases();
  const preferences = usePreferences();

  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'summary' | 'phrase' | 'done' | null>(null);
  const [typedPhrase, setTypedPhrase] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  function announce(tone: NoticeMessage['tone'], text: string) {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }

  const refreshStorage = useCallback(async () => {
    if (settings) setStorage(await settings.getStorageSummary());
  }, [settings]);

  // Read again whenever Settings is shown: records and files change elsewhere.
  useFocusEffect(
    useCallback(() => {
      void refreshStorage();
    }, [refreshStorage])
  );

  // The field shows the stored name until the Teacher types.
  const nameValue = name ?? preferences.teacherName;
  const nameChanged = nameValue.trim() !== preferences.teacherName;

  async function saveName() {
    if (isSavingName) return;
    setIsSavingName(true);
    setNameError(null);
    try {
      const stored = await preferences.setTeacherName(nameValue);
      setName(null);
      announce('success', stored.length > 0 ? `Home will greet you as ${stored}` : 'Display name removed');
    } catch (error) {
      const message =
        error instanceof InvalidTeacherNameError
          ? `A display name can have at most ${TEACHER_NAME_MAX_LENGTH} characters.`
          : 'The name could not be saved on this device. Try again.';
      if (!(error instanceof InvalidTeacherNameError)) console.error(error);
      setNameError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      setIsSavingName(false);
    }
  }

  async function cleanTemporaryFiles() {
    if (!settings || isCleaning) return;
    setIsCleaning(true);
    try {
      const freed = await settings.cleanTemporaryFiles();
      announce(
        'success',
        freed > 0 ? `Temporary files removed: ${formatBytes(freed)} freed` : 'No temporary files to remove'
      );
    } catch (error) {
      console.error(error);
      announce('error', 'Temporary files could not be removed. Nothing else was changed. Try again.');
    } finally {
      setIsCleaning(false);
      void refreshStorage();
    }
  }

  function closeDelete() {
    if (isDeleting) return;
    setDeleteStep(null);
    setTypedPhrase('');
    setDeleteFailure(null);
  }

  async function deleteAll() {
    if (!settings || isSubmitting.current || !isDeleteAllPhrase(typedPhrase)) return;
    isSubmitting.current = true;
    setIsDeleting(true);
    setDeleteFailure(null);
    try {
      await settings.deleteAllAcademicData(typedPhrase);
      setTypedPhrase('');
      setDeleteStep('done');
      AccessibilityInfo.announceForAccessibility('All academic data was deleted');
      void refreshStorage();
    } catch (error) {
      console.error(error);
      const message = 'Nothing was deleted: the data could not be removed on this device. Try again.';
      setDeleteFailure(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      isSubmitting.current = false;
      setIsDeleting(false);
    }
  }

  // The first reading of the numbers: nothing for a moment, then bars where they will be.
  const storagePhase = useLoadingPhase(settings !== null && storage === null);
  const counts = storage?.counts ?? null;
  const countOrDash = (value: number | undefined) => (value === undefined ? '–' : value.toLocaleString());
  const build =
    Platform.OS === 'android'
      ? Constants.expoConfig?.android?.versionCode
      : Constants.expoConfig?.ios?.buildNumber;

  return (
    <Screen
      title={destinationTitle('settings')}
      showBack
      overlay={
        notice && <Notice key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
      }>
      <Section title="Appearance">
        <View
          role="radiogroup"
          accessibilityLabel="Appearance"
          className="overflow-hidden rounded-lg border border-border bg-card">
          {APPEARANCE_OPTIONS.map((option, index) => (
            <OptionRow
              key={option.id}
              name={option.name}
              detail={option.detail}
              isSelected={preferences.appearance === option.id}
              isFirst={index === 0}
              onPress={() => {
                if (preferences.appearance === option.id) return;
                preferences.setAppearance(option.id);
                AccessibilityInfo.announceForAccessibility(`${option.name} appearance selected`);
              }}
            />
          ))}
        </View>
        {!settings && (
          <Text className="text-[13px] leading-[18px] text-muted-foreground">
            This web preview does not remember the choice. The phone does.
          </Text>
        )}
      </Section>

      <Section title="Display name">
        <Card>
          <Text nativeID="display-name-label" className="text-sm leading-5">
            Optional. Home greets you by this name instead of “Teacher”. It stays on this phone and
            is not an account.
          </Text>
          <Input
            value={nameValue}
            onChangeText={(text) => {
              setName(text);
              setNameError(null);
            }}
            placeholder="Teacher"
            accessibilityLabel="Display name, optional"
            aria-invalid={nameError !== null}
            maxLength={TEACHER_NAME_MAX_LENGTH + 10}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void saveName()}
          />
          {nameError !== null && (
            <Text role="alert" className="text-sm leading-5 text-destructive">
              {nameError}
            </Text>
          )}
          <Button
            variant="outline"
            className="h-12 self-start"
            disabled={!nameChanged || isSavingName}
            aria-busy={isSavingName}
            onPress={() => void saveName()}>
            <Text>Save name</Text>
          </Button>
        </Card>
      </Section>

      <Section title="Camera permission">
        {Platform.OS === 'web' ? (
          <Card>
            <Text className="text-sm text-muted-foreground">
              Only on the phone. This web preview has no camera permission to show.
            </Text>
          </Card>
        ) : (
          <CameraPermissionCard onOpenScan={() => router.navigate('/scan')} />
        )}
      </Section>

      <Section title="Local data and storage">
        <Card>
          <Text className="text-sm leading-5">
            Your academic data and scan images are stored locally on this device. The app does not
            require an internet connection or a cloud account.
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            They are kept in the app&apos;s private storage, which the phone protects from other
            apps. The app does not encrypt them itself. Uninstalling the app or clearing its data
            removes everything, and the app keeps no backup.
          </Text>
          {settings && (storage === null || storagePhase !== 'content') ? (
            <View className="min-h-[196px] border-t border-border pt-3">
              <Pending phase={storagePhase} label="Loading storage information" className="gap-3">
                {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                  <View key={row} className="flex-row items-center justify-between gap-3">
                    <Skeleton className={row % 2 === 0 ? 'h-3.5 w-24' : 'h-3.5 w-32'} />
                    <Skeleton className="h-3.5 w-12" />
                  </View>
                ))}
              </Pending>
            </View>
          ) : settings ? (
            <>
              <View className="gap-1.5 border-t border-border pt-3">
                <Fact label="Students" value={countOrDash(counts?.students)} />
                <Fact label="Classes" value={countOrDash(counts?.classes)} />
                <Fact label="Subjects" value={countOrDash(counts?.subjects)} />
                <Fact label="Answer keys" value={countOrDash(counts?.answerKeys)} />
                <Fact label="Results" value={countOrDash(counts?.results)} />
              </View>
              <View className="gap-1.5 border-t border-border pt-3">
                <Fact
                  label="Stored scan images"
                  value={storage ? `About ${sizeOf(storage.scanImageBytes)}` : '–'}
                />
                <Fact
                  label="Temporary files"
                  value={storage ? `About ${sizeOf(storage.temporaryBytes)}` : '–'}
                />
              </View>
            </>
          ) : (
            <Text className="border-t border-border pt-3 text-sm text-muted-foreground">
              Only on the phone. This web preview stores nothing.
            </Text>
          )}
        </Card>
        {settings && (
          <Card>
            <Text className="text-sm leading-5">
              Temporary files are leftovers of scanning, roster imports, and shared answer sheets.
              Removing them never touches a saved result, its scan image, or your own files.
            </Text>
            <Button
              variant="outline"
              className="h-12 self-start"
              disabled={isCleaning}
              aria-busy={isCleaning}
              onPress={() => void cleanTemporaryFiles()}>
              {isCleaning ? (
                <ActivityIndicator size="small" className="text-foreground" />
              ) : (
                <Icon as={Eraser} size={16} />
              )}
              <Text>Clean temporary files</Text>
            </Button>
          </Card>
        )}
      </Section>

      <Section title="Answer sheets">
        <Card>
          <Text className="text-sm leading-5">
            The app makes its own answer sheet for each answer key, with exactly that key&apos;s
            number of questions and choices A to D.
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            To get one, open Scan, choose the answer key, and tap “View or share printable sheet”.
            Print it on A4 in black. A sheet printed for another number of questions is not read.
          </Text>
        </Card>
      </Section>

      <Section title="About">
        <Card>
          <View className="gap-1">
            <Text className="text-[15px] font-semibold leading-[22px]">Answer Checker</Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              {describeVersion(Constants.expoConfig?.version, build)}
            </Text>
          </View>
          <Text className="text-sm leading-5">
            Works offline. Everything stays on this phone: there is no account, no sign-in, no
            sync, and nothing is sent over the internet.
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            The camera photographs answer sheets and nothing else. Student names and Student IDs
            are only what you enter or import. Handwriting on a sheet is not read.
          </Text>
        </Card>
      </Section>

      {/* Development builds only; all three render nothing otherwise. */}
      <DemoDataSection onDone={announce} />
      <SlowLoadingSection />
      <DiagnosticsSection />

      {settings && (
        <Section title="Danger zone">
          <Card className="border-destructive/50">
            <Text className="text-sm leading-5">
              Permanently deletes every subject, class, student, answer key, and result on this
              phone, with all stored scan images. There is no backup and it cannot be undone.
            </Text>
            <Button
              variant="outline"
              className="h-12 self-start border-destructive/50"
              onPress={() => setDeleteStep('summary')}>
              <Icon as={Trash} size={16} className="text-destructive" />
              <Text className="text-destructive">Delete all academic data</Text>
            </Button>
          </Card>
        </Section>
      )}

      {deleteStep === 'summary' && (
        <ModalCard onRequestClose={closeDelete}>
          <View className="gap-2">
            <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
              Delete all academic data?
            </Text>
            <Text className="text-[15px] leading-[22px]">This permanently deletes from this phone:</Text>
            <View className="gap-1 rounded-lg bg-muted p-3">
              <Fact label="Students" value={countOrDash(counts?.students)} />
              <Fact label="Classes" value={countOrDash(counts?.classes)} />
              <Fact label="Subjects" value={countOrDash(counts?.subjects)} />
              <Fact label="Answer keys" value={countOrDash(counts?.answerKeys)} />
              <Fact label="Results, with their answers" value={countOrDash(counts?.results)} />
              <Fact label="Stored scan images" value={storage ? sizeOf(storage.scanImageBytes) : '–'} />
            </View>
            <Text className="text-[15px] leading-[22px]">
              There is no cloud backup and no copy anywhere else. This cannot be undone.
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              Your appearance and display name are kept. Files outside the app, such as a class
              list you imported from, are not touched.
            </Text>
          </View>
          <View className="flex-row gap-3">
            <Button variant="outline" className="h-12 flex-1" onPress={closeDelete}>
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="destructive"
              className="h-12 flex-1"
              onPress={() => setDeleteStep('phrase')}>
              <Text>Continue</Text>
            </Button>
          </View>
        </ModalCard>
      )}

      {deleteStep === 'phrase' && (
        <ModalCard position="top" onRequestClose={closeDelete}>
          <View className="gap-2">
            <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
              Confirm permanent deletion
            </Text>
            <Text className="text-[15px] leading-[22px]">
              Type {DELETE_ALL_PHRASE} to delete all academic data from this phone.
            </Text>
            <Input
              value={typedPhrase}
              onChangeText={(text) => {
                setTypedPhrase(text);
                setDeleteFailure(null);
              }}
              placeholder={DELETE_ALL_PHRASE}
              accessibilityLabel={`Type ${DELETE_ALL_PHRASE} to confirm`}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isDeleting}
            />
            {deleteFailure !== null && (
              <Text role="alert" className="text-sm leading-5 text-destructive">
                {deleteFailure}
              </Text>
            )}
          </View>
          <View className="flex-row gap-3">
            <Button variant="outline" className="h-12 flex-1" disabled={isDeleting} onPress={closeDelete}>
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="destructive"
              className="h-12 flex-1"
              disabled={!isDeleteAllPhrase(typedPhrase) || isDeleting}
              aria-busy={isDeleting}
              accessibilityLabel="Delete all academic data permanently"
              onPress={() => void deleteAll()}>
              {isDeleting && <ActivityIndicator size="small" className="text-white" />}
              <Text>{isDeleting ? 'Deleting' : 'Delete all'}</Text>
            </Button>
          </View>
        </ModalCard>
      )}

      {deleteStep === 'done' && (
        <ModalCard
          onRequestClose={() => {
            setDeleteStep(null);
            router.navigate('/');
          }}>
          <View className="gap-2">
            <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
              All academic data was deleted
            </Text>
            <Text className="text-[15px] leading-[22px]">
              The app is empty and ready for new subjects, classes, students, and answer keys.
            </Text>
          </View>
          <Button
            className="h-12"
            onPress={() => {
              setDeleteStep(null);
              router.navigate('/');
            }}>
            <Text>Go to Home</Text>
          </Button>
        </ModalCard>
      )}
    </Screen>
  );
}
