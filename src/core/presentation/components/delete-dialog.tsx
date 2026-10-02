import { ActivityIndicator, View } from 'react-native';

import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Text } from '@/core/presentation/components/ui/text';

type DeleteDialogProps = {
  /** The exact name of the record, as the Teacher wrote it. */
  name: string;
  /** What the record is, in lower case: "subject", "class". */
  noun: string;
  /** One more line that identifies the record, such as its subject. */
  detail?: string;
  isDeleting: boolean;
  /** Set when other records depend on this one. The dialog then only explains and closes. */
  blockedMessage: string | null;
  /** Set when the attempt failed for another reason. The Teacher can try again. */
  failureMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation for "Delete permanently". Cancel comes first and is also what
 * the Android back button does. Mount it only while it is open.
 */
export function DeleteDialog({
  name,
  noun,
  detail,
  isDeleting,
  blockedMessage,
  failureMessage,
  onConfirm,
  onCancel,
}: DeleteDialogProps) {
  const close = () => {
    if (!isDeleting) onCancel();
  };

  if (blockedMessage !== null) {
    return (
      <ModalCard onRequestClose={close}>
        <View className="gap-2">
          <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
            “{name}” cannot be deleted
          </Text>
          <Text accessibilityLiveRegion="polite" className="text-[15px] leading-[22px]">
            {blockedMessage}
          </Text>
        </View>
        <Button variant="outline" className="h-12" onPress={onCancel}>
          <Text>Close</Text>
        </Button>
      </ModalCard>
    );
  }

  return (
    <ModalCard onRequestClose={close}>
      <View className="gap-2">
        <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
          Delete “{name}”?
        </Text>
        {detail !== undefined && <Text className="text-[15px] leading-[22px]">{detail}</Text>}
        <Text className="text-[15px] leading-[22px] text-muted-foreground">
          This permanently deletes the {noun} from this device. It cannot be undone.
        </Text>
        {failureMessage !== null && (
          <Text
            accessibilityLiveRegion="polite"
            role="alert"
            className="text-sm leading-5 text-destructive">
            {failureMessage}
          </Text>
        )}
      </View>
      <View className="flex-row gap-3">
        <Button variant="outline" className="h-12 flex-1" disabled={isDeleting} onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
        <Button
          variant="destructive"
          className="h-12 flex-1"
          disabled={isDeleting}
          aria-busy={isDeleting}
          accessibilityLabel={`Delete ${name} permanently`}
          onPress={onConfirm}>
          {isDeleting && <ActivityIndicator size="small" className="text-white" />}
          <Text>{isDeleting ? 'Deleting' : 'Delete'}</Text>
        </Button>
      </View>
    </ModalCard>
  );
}
