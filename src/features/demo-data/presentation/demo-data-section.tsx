import FlaskConical from 'lucide-react-native/icons/flask-conical';
import Trash from 'lucide-react-native/icons/trash';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { DemoDataConflictError } from '@/features/demo-data/application/demo-data-use-cases';
import { useDemoDataUseCases } from '@/features/demo-data/presentation/demo-data-use-cases-context';

type DemoDataSectionProps = {
  /** Reports what happened, for the screen's notice. */
  onDone: (tone: 'success' | 'error', text: string) => void;
};

/**
 * Adds and removes made-up records for trying the app out. Shown only in
 * development builds and only where there is a database; a release build and
 * the web preview render nothing.
 */
export function DemoDataSection({ onDone }: DemoDataSectionProps) {
  const demo = useDemoDataUseCases();
  const [hasDemoData, setHasDemoData] = useState<boolean | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  // Read again whenever Settings is shown: demo records can be deleted elsewhere.
  useFocusEffect(
    useCallback(() => {
      if (!demo) return;
      let isCurrent = true;
      demo.hasDemoData().then(
        (found) => {
          if (isCurrent) setHasDemoData(found);
        },
        (error) => console.error(error)
      );
      return () => {
        isCurrent = false;
      };
    }, [demo])
  );

  if (!__DEV__ || !demo) return null;

  async function run(task: () => Promise<void>) {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setIsWorking(true);
    try {
      await task();
    } catch (error) {
      if (error instanceof DemoDataConflictError) {
        onDone(
          'error',
          'A record of yours already uses a demo name or Student ID. Nothing was added.'
        );
      } else {
        console.error(error);
        onDone('error', 'Something went wrong on this device. Nothing was changed.');
      }
    } finally {
      isSubmitting.current = false;
      setIsWorking(false);
      setIsConfirming(false);
    }
  }

  const add = () =>
    run(async () => {
      const added = await demo.addDemoData();
      setHasDemoData(true);
      onDone('success', added ? 'Demo data added' : 'Demo data is already there');
    });

  const remove = () =>
    run(async () => {
      const removed = await demo.removeDemoData();
      setHasDemoData(false);
      onDone(
        'success',
        `Demo data removed: ${countOf(removed.results, 'result')}, ${countOf(removed.students, 'student')}, ${countOf(removed.answerKeys, 'answer key')}`
      );
    });

  return (
    <View className="gap-3">
      <Text variant="h4" aria-level="2" className="text-base">
        Demo data
      </Text>
      <View className="gap-3 rounded-lg border border-border bg-card p-4">
        <Text className="text-sm">
          Made-up subjects, classes, students, answer keys, and saved results for trying the app
          out. Their names start with “Demo” and their Student IDs with “DEMO-”.
        </Text>
        <Text className="text-sm text-muted-foreground">
          Demo results have no scan image. This section appears only in development builds.
        </Text>
        {hasDemoData ? (
          <Button
            variant="outline"
            className="h-12 self-start border-destructive/50"
            disabled={isWorking}
            onPress={() => setIsConfirming(true)}>
            <Icon as={Trash} size={16} className="text-destructive" />
            <Text className="text-destructive">Remove demo data</Text>
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-12 self-start"
            disabled={isWorking || hasDemoData === null}
            aria-busy={isWorking}
            onPress={() => void add()}>
            {isWorking ? (
              <ActivityIndicator size="small" className="text-foreground" />
            ) : (
              <Icon as={FlaskConical} size={16} />
            )}
            <Text>Add demo data</Text>
          </Button>
        )}
      </View>

      {isConfirming && (
        <ModalCard
          onRequestClose={() => {
            if (!isWorking) setIsConfirming(false);
          }}>
          <View className="gap-2">
            <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
              Remove demo data?
            </Text>
            <Text className="text-[15px] leading-[22px]">
              This permanently deletes every demo record, and anything you saved under one: results
              scanned for a demo student or with a demo answer key, students you added to a demo
              class, and answer keys you added to a demo subject.
            </Text>
            <Text className="text-[15px] leading-[22px] text-muted-foreground">
              Your other records are not touched. It cannot be undone.
            </Text>
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={isWorking}
              onPress={() => setIsConfirming(false)}>
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="destructive"
              className="h-12 flex-1"
              disabled={isWorking}
              aria-busy={isWorking}
              onPress={() => void remove()}>
              {isWorking && <ActivityIndicator size="small" className="text-white" />}
              <Text>{isWorking ? 'Removing' : 'Remove'}</Text>
            </Button>
          </View>
        </ModalCard>
      )}
    </View>
  );
}
