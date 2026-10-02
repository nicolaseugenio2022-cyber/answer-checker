import { cn } from '@/core/presentation/lib/utils';
import { Platform, TextInput } from 'react-native';

/** React Native Reusables input (New York), 48dp high so it meets the Android touch target. */
function Input({
  className,
  ...props
}: React.ComponentProps<typeof TextInput> & React.RefAttributes<TextInput>) {
  return (
    <TextInput
      className={cn(
        'h-12 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base leading-5 text-foreground dark:bg-input/30',
        props.editable === false && 'opacity-50',
        Platform.select({
          web: 'outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive',
          native: 'placeholder:text-muted-foreground/70',
        }),
        className
      )}
      {...props}
    />
  );
}

export { Input };
