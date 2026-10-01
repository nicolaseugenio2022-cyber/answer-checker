import { useColorScheme } from 'nativewind';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/core/presentation/components/ui/button';
import { Text } from '@/core/presentation/components/ui/text';
import { SampleSheet } from '@/features/dashboard/presentation/sample-sheet';

const WORKFLOW_STEPS = [
  'Create an exam and its answer key.',
  'Scan a shaded answer sheet with the camera.',
  'Review any answers the scanner flags as blank, double-marked, or unclear.',
  'Score the sheet against the answer key.',
  'Save the result on this phone.',
] as const;

export function HomeScreen() {
  const { colorScheme, toggleColorScheme } = useColorScheme();

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerClassName="w-full max-w-xl gap-8 self-center px-5 py-8">
          <View className="gap-2">
            <Text variant="h3" aria-level="1">
              Answer Checker
            </Text>
            <Text className="text-muted-foreground">
              Check shaded answer sheets with this phone. Everything runs on the device, so it
              works without internet.
            </Text>
          </View>

          <View className="gap-3">
            <SampleSheet />
            <Text variant="muted">
              An example of how a sheet will be read. Rows with no mark or more than one mark go to
              you for review before scoring.
            </Text>
          </View>

          <View className="gap-3">
            <Text variant="h4" aria-level="2">
              How checking a sheet will work
            </Text>
            <View className="gap-3">
              {WORKFLOW_STEPS.map((step, index) => (
                <View key={step} className="flex-row gap-3">
                  <Text className="w-5 text-sm text-muted-foreground">{index + 1}</Text>
                  <Text className="flex-1 text-sm">{step}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="rounded-lg bg-accent px-4 py-3">
            <Text className="text-sm text-accent-foreground">
              None of these steps are built yet. This version sets up the design, the navigation,
              and the on-device database the steps will use.
            </Text>
          </View>

          <View className="gap-3">
            <Button size="lg" disabled>
              <Text>Scan answer sheet</Text>
            </Button>
            <Button size="lg" variant="outline" onPress={toggleColorScheme}>
              <Text>
                {colorScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              </Text>
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
