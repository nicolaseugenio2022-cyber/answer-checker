import type { LucideIcon } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { Icon } from '@/core/presentation/components/ui/icon';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

type RowActionProps = {
  icon: LucideIcon;
  /** Accessible name that includes the record, such as "Rename Mathematics". */
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

/** A 48dp icon button at the end of a list row. */
export function RowAction({ icon, label, destructive = false, onPress }: RowActionProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        'h-12 w-12 items-center justify-center rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isPressed && (destructive ? 'bg-destructive/15' : 'bg-secondary')
      )}>
      <Icon
        as={icon}
        size={20}
        className={destructive ? 'text-destructive' : 'text-muted-foreground'}
      />
    </Pressable>
  );
}
