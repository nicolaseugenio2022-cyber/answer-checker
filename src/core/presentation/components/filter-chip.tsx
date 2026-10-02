import Check from 'lucide-react-native/icons/check';
import { Pressable } from 'react-native';

import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

type FilterChipProps = {
  label: string;
  isSelected: boolean;
  onPress: () => void;
};

/**
 * One choice in a row of filters. The chosen one is filled and carries a
 * check, not only a color. Put the chips in a container with the role
 * `radiogroup`.
 */
export function FilterChip({ label, isSelected, onPress }: FilterChipProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      hitSlop={{ top: 2, bottom: 2 }}
      role="radio"
      aria-checked={isSelected}
      accessibilityLabel={label}
      className={cn(
        'h-11 flex-row items-center gap-1.5 rounded-full border px-4 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isSelected ? 'border-primary bg-primary' : 'border-border bg-card',
        isPressed && !isSelected && 'bg-secondary',
        isPressed && isSelected && 'opacity-80'
      )}>
      {isSelected && (
        <Icon as={Check} size={14} strokeWidth={3} className="text-primary-foreground" />
      )}
      <Text
        className={cn(
          'text-sm font-medium',
          isSelected ? 'text-primary-foreground' : 'text-foreground'
        )}>
        {label}
      </Text>
    </Pressable>
  );
}
