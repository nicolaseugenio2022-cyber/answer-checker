import { Pressable, View } from 'react-native';

import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

type ChoiceListProps = {
  options: readonly { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Adds a first option that selects nothing, with this label. */
  noneLabel?: string;
  disabled?: boolean;
  /** Accessible name of the whole group, such as "Class". */
  label: string;
};

/**
 * A single-choice list of existing records, such as classes or subjects. Whole
 * rows are the touch targets, and the chosen one shows a filled dot, not only
 * a color.
 */
export function ChoiceList({
  options,
  selectedId,
  onSelect,
  noneLabel,
  disabled = false,
  label,
}: ChoiceListProps) {
  return (
    <View role="radiogroup" accessibilityLabel={label}>
      {noneLabel !== undefined && (
        <Choice
          name={noneLabel}
          isSelected={selectedId === null}
          isFirst
          disabled={disabled}
          muted
          onPress={() => onSelect(null)}
        />
      )}
      {options.map((option, index) => (
        <Choice
          key={option.id}
          name={option.name}
          isSelected={selectedId === option.id}
          isFirst={index === 0 && noneLabel === undefined}
          disabled={disabled}
          onPress={() => onSelect(option.id)}
        />
      ))}
    </View>
  );
}

type ChoiceProps = {
  name: string;
  isSelected: boolean;
  isFirst: boolean;
  disabled: boolean;
  muted?: boolean;
  onPress: () => void;
};

function Choice({ name, isSelected, isFirst, disabled, muted = false, onPress }: ChoiceProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      disabled={disabled}
      role="radio"
      aria-checked={isSelected}
      accessibilityLabel={name}
      className={cn(
        'min-h-12 flex-row items-center gap-3 px-3 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        !isFirst && 'border-t border-border',
        isSelected && 'bg-accent/50',
        isPressed && 'bg-secondary',
        disabled && 'opacity-60'
      )}>
      <View
        className={cn(
          'h-[22px] w-[22px] items-center justify-center rounded-full border-2',
          isSelected ? 'border-primary' : 'border-input'
        )}>
        {isSelected && <View className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </View>
      <Text
        className={cn(
          'flex-1 text-[15px] leading-[22px]',
          muted ? 'text-muted-foreground' : 'font-medium'
        )}>
        {name}
      </Text>
    </Pressable>
  );
}
