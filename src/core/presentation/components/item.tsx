import type { LucideIcon } from 'lucide-react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Children, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

/**
 * Native take on shadcn's Item: a row with media, title, description, and a
 * trailing action, grouped with separators. Rows are whole-row press targets
 * of at least 52dp rather than rows with a small inner button.
 */

type ItemGroupProps = {
  children: ReactNode;
  /** Surface classes for the group. Defaults to a solid card. */
  className?: string;
};

export function ItemGroup({ children, className }: ItemGroupProps) {
  return (
    <View className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      {Children.toArray(children).map((child, index) => (
        <View key={index} className={cn(index > 0 && 'border-t border-border')}>
          {child}
        </View>
      ))}
    </View>
  );
}

type ItemProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Short verb shown before the chevron, in the identity color. */
  actionLabel?: string;
  onPress: () => void;
};

export function Item({ title, description, icon, actionLabel, onPress }: ItemProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={[title, description, actionLabel].filter(Boolean).join('. ')}
      className={cn(
        'min-h-[52px] flex-row items-center gap-3 px-3 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isPressed && 'bg-secondary'
      )}>
      {icon && (
        <View className="h-9 w-9 items-center justify-center rounded-md bg-muted">
          <Icon as={icon} size={18} className="text-muted-foreground" />
        </View>
      )}
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium">{title}</Text>
        {description && <Text className="text-sm text-muted-foreground">{description}</Text>}
      </View>
      {actionLabel && <Text className="text-sm font-semibold text-primary">{actionLabel}</Text>}
      <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
    </Pressable>
  );
}
