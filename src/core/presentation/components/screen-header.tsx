import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import { Pressable, View } from 'react-native';

import { RefreshIndicator } from '@/core/presentation/components/skeleton';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import type { LoadingPhase } from '@/core/presentation/lib/loading-gate';
import { cn } from '@/core/presentation/lib/utils';

type ScreenHeaderProps = {
  title: string;
  /** Shows a back button, for screens opened from Home rather than from a tab. */
  showBack?: boolean;
  /** The phase of a background refresh; a small spinner shows at the end of the row while it lasts. */
  refreshPhase?: LoadingPhase;
};

/**
 * Compact top app bar shared by every screen except Home: one 56dp row with an
 * optional back button and the title. It has no background or divider of its
 * own, so it reads as part of the screen. The screen pads the status-bar inset.
 */
export function ScreenHeader({ title, showBack = false, refreshPhase = 'content' }: ScreenHeaderProps) {
  const router = useRouter();
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <View className="min-h-14 flex-row items-center gap-1 px-4">
      {showBack && (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
          {...pressHandlers}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className={cn(
            '-ml-3 h-12 w-12 items-center justify-center rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
            isPressed && 'bg-foreground/10'
          )}>
          <Icon as={ArrowLeft} size={22} />
        </Pressable>
      )}
      <Text
        role="heading"
        aria-level="1"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={1.4}
        className="flex-1 text-2xl font-semibold leading-8 tracking-tight">
        {title}
      </Text>
      <RefreshIndicator phase={refreshPhase} />
    </View>
  );
}
