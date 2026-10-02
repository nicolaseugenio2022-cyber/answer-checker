import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { GLASS_CLASSES } from '@/core/presentation/components/glass-surface';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { cn } from '@/core/presentation/lib/utils';

type CalloutProps = {
  icon: LucideIcon;
  title: string;
  tone?: 'neutral' | 'error';
  /** The explanation, as plain text. */
  children: ReactNode;
  action?: ReactNode;
};

/** The one panel a list state uses to explain itself: empty, failed, or device-only. */
export function Callout({ icon, title, tone = 'neutral', children, action }: CalloutProps) {
  return (
    <View className={cn('flex-row items-start gap-3 rounded-lg p-4', GLASS_CLASSES)}>
      <View
        className={cn(
          'h-10 w-10 items-center justify-center rounded-md',
          tone === 'error' ? 'bg-destructive/15' : 'bg-accent'
        )}>
        <Icon
          as={icon}
          size={18}
          className={tone === 'error' ? 'text-destructive' : 'text-accent-foreground'}
        />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-[15px] font-semibold leading-[22px]">{title}</Text>
        <Text className="text-sm leading-5 text-muted-foreground">{children}</Text>
        {action && <View className="pt-2">{action}</View>}
      </View>
    </View>
  );
}
