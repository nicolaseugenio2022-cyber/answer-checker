import Search from 'lucide-react-native/icons/search';
import X from 'lucide-react-native/icons/x';
import { Pressable, View } from 'react-native';

import { Icon } from '@/core/presentation/components/ui/icon';
import { Input } from '@/core/presentation/components/ui/input';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

type SearchFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
};

/** A search box with a leading icon and, once something is typed, a 48dp clear button. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: SearchFieldProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <View className="justify-center">
      <Input
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        className="pl-10 pr-12"
      />
      <View pointerEvents="none" className="absolute left-3">
        <Icon as={Search} size={18} className="text-muted-foreground" />
      </View>
      {value.length > 0 && (
        <View className="absolute right-0">
          <Pressable
            onPress={() => onChangeText('')}
            {...pressHandlers}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            className={cn(
              'h-12 w-12 items-center justify-center rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
              isPressed && 'bg-foreground/10'
            )}>
            <Icon as={X} size={18} className="text-muted-foreground" />
          </Pressable>
        </View>
      )}
    </View>
  );
}
