import { useRef, useState } from 'react';
import { ActivityIndicator, View, type TextInput } from 'react-native';

import { findNameProblem, nameLength, normalizeName } from '@/core/domain/record-name';
import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Input } from '@/core/presentation/components/ui/input';
import { Text } from '@/core/presentation/components/ui/text';

type NameFormDialogProps = {
  title: string;
  fieldLabel: string;
  placeholder: string;
  /** Empty when adding; the current name when renaming. */
  initialName: string;
  submitLabel: string;
  maxLength: number;
  /**
   * Saves the trimmed name. Resolves to null on success (the parent then
   * unmounts the dialog) or to a message to show under the field; the typed
   * text is kept so the Teacher can correct it.
   */
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
};

/** One-field form for adding or renaming a record. Mount it only while it is open. */
export function NameFormDialog({
  title,
  fieldLabel,
  placeholder,
  initialName,
  submitLabel,
  maxLength,
  onSubmit,
  onCancel,
}: NameFormDialogProps) {
  const [value, setValue] = useState(initialName);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  const name = normalizeName(value);
  const problem = findNameProblem(name, maxLength);
  const errorMessage =
    problem === 'TOO_LONG'
      ? `Use ${maxLength} characters or fewer. This name has ${nameLength(name)}.`
      : submitError;
  const canSubmit = problem === null && !isSaving;

  async function submit() {
    if (problem !== null || isSubmitting.current) return;
    isSubmitting.current = true;
    setIsSaving(true);
    setSubmitError(null);
    const error = await onSubmit(name);
    if (error !== null) {
      isSubmitting.current = false;
      setIsSaving(false);
      setSubmitError(error);
    }
  }

  return (
    <ModalCard
      position="top"
      onRequestClose={() => {
        if (!isSaving) onCancel();
      }}
      onShow={() => inputRef.current?.focus()}>
      <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
        {title}
      </Text>

      <View className="gap-2">
        <Text className="text-sm font-medium">{fieldLabel}</Text>
        <Input
          ref={inputRef}
          value={value}
          onChangeText={(text) => {
            setValue(text);
            setSubmitError(null);
          }}
          placeholder={placeholder}
          accessibilityLabel={fieldLabel}
          aria-invalid={errorMessage !== null}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          submitBehavior="submit"
          onSubmitEditing={submit}
          editable={!isSaving}
          className={errorMessage !== null ? 'border-destructive' : undefined}
        />
        {errorMessage !== null ? (
          <Text
            accessibilityLiveRegion="polite"
            role="alert"
            className="text-sm leading-5 text-destructive">
            {errorMessage}
          </Text>
        ) : (
          <Text className="text-sm leading-5 text-muted-foreground">
            Up to {maxLength} characters.
          </Text>
        )}
      </View>

      <View className="flex-row gap-3">
        <Button variant="outline" className="h-12 flex-1" disabled={isSaving} onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
        <Button
          className="h-12 flex-1"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          aria-busy={isSaving}
          onPress={submit}>
          {isSaving && <ActivityIndicator size="small" className="text-primary-foreground" />}
          <Text>{isSaving ? 'Saving' : submitLabel}</Text>
        </Button>
      </View>
    </ModalCard>
  );
}
