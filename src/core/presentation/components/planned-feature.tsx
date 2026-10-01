import type { LucideIcon } from 'lucide-react-native';
import CircleDashed from 'lucide-react-native/icons/circle-dashed';
import { View } from 'react-native';

import { GLASS_CLASSES } from '@/core/presentation/components/glass-surface';
import { Screen } from '@/core/presentation/components/screen';
import { Badge } from '@/core/presentation/components/ui/badge';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { cn } from '@/core/presentation/lib/utils';

type PlannedFeatureProps = {
  title: string;
  /** Adds a back button, for screens opened from Home rather than from a tab. */
  showBack?: boolean;
  icon: LucideIcon;
  /** One or two sentences on what the Teacher will do on this screen. */
  summary: string;
  /** Specific things the screen will let the Teacher do once built. */
  abilities: readonly string[];
};

/** A destination whose feature is not implemented yet. Shows no controls or data. */
export function PlannedFeature({ title, showBack, icon, summary, abilities }: PlannedFeatureProps) {
  return (
    <Screen title={title} showBack={showBack}>
      <View className={cn('gap-3 rounded-lg p-4', GLASS_CLASSES)}>
        <View className="flex-row items-start gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-md bg-accent">
            <Icon as={icon} size={18} className="text-accent-foreground" />
          </View>
          <Text className="flex-1 text-[15px] leading-[22px]">{summary}</Text>
        </View>
        <Badge variant="outline" className="self-start border-dashed border-input">
          <Icon as={CircleDashed} size={12} className="text-muted-foreground" />
          <Text className="text-muted-foreground">Not built yet</Text>
        </Badge>
      </View>

      <View className="gap-3">
        <Text variant="h4" aria-level="2" className="text-base">
          What you will be able to do here
        </Text>
        <View className="rounded-lg border border-border bg-card">
          {abilities.map((ability, index) => (
            <View
              key={ability}
              className={cn(
                'flex-row items-start gap-3 px-4 py-3',
                index > 0 && 'border-t border-border'
              )}>
              <View className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
              <Text className="flex-1 text-sm leading-5">{ability}</Text>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}
