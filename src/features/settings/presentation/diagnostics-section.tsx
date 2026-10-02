import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/core/presentation/components/ui/button';
import { Text } from '@/core/presentation/components/ui/text';
import { getStartupMarks, timed } from '@/core/presentation/lib/startup-marks';
import { useAnswerKeyUseCases } from '@/features/answer-keys/presentation/answer-key-use-cases-context';
import { useClassUseCases } from '@/features/classes/presentation/class-use-cases-context';
import { useDashboardUseCases } from '@/features/dashboard/presentation/dashboard-use-cases-context';
import { NO_FILTER } from '@/features/results/domain/result-filter';
import { useResultsUseCases } from '@/features/results/presentation/results-use-cases-context';
import { EMPTY_SELECTION } from '@/features/scan/domain/selection';
import { useScanUseCases } from '@/features/scan/presentation/scan-use-cases-context';
import { useSettingsUseCases } from '@/features/settings/presentation/settings-use-cases-context';
import { useStudentUseCases } from '@/features/students/presentation/student-use-cases-context';
import { useSubjectUseCases } from '@/features/subjects/presentation/subject-use-cases-context';

type Timing = { name: string; ms: number | null };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} className="flex-row gap-3">
      <Text className="flex-1 text-sm leading-5 text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium leading-5">{value}</Text>
    </View>
  );
}

/**
 * Start-up and query timings, measured on this device, for telling a slow
 * bundle from a slow database from a slow screen. Each screen's first read is
 * run once through its own use case and timed; nothing is changed. Shown only
 * in development builds; a release build renders nothing.
 *
 * It cannot see the time Metro takes to build and send the bundle: that
 * happens before any of the app's code runs.
 */
export function DiagnosticsSection() {
  const dashboard = useDashboardUseCases();
  const results = useResultsUseCases();
  const students = useStudentUseCases();
  const answerKeys = useAnswerKeyUseCases();
  const subjects = useSubjectUseCases();
  const classes = useClassUseCases();
  const scan = useScanUseCases();
  const settings = useSettingsUseCases();

  const [timings, setTimings] = useState<Timing[] | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(false);

  if (!__DEV__) return null;

  async function measure() {
    if (isMeasuring) return;
    setIsMeasuring(true);
    const reads: [string, (() => Promise<unknown>) | null][] = [
      ['Home dashboard', dashboard && (() => dashboard.getDashboard())],
      ['Subjects list', subjects && (() => subjects.listSubjects())],
      ['Classes list', classes && (() => classes.listClasses())],
      ['Students list', students && (() => students.listStudents())],
      ['Answer keys list', answerKeys && (() => answerKeys.listAnswerKeys())],
      ['Scan setup options', scan && (() => scan.listOptions(EMPTY_SELECTION))],
      ['Results first page', results && (() => results.listResults({ filter: NO_FILTER, search: '' }))],
      ['Results counts', results && (() => results.countResults(NO_FILTER, ''))],
      ['Results filters', results && (() => results.listFilterLinks())],
      ['Settings storage summary', settings && (() => settings.getStorageSummary())],
    ];
    const measured: Timing[] = [];
    // One after another, so each time is that read alone.
    for (const [name, read] of reads) {
      if (!read) {
        measured.push({ name, ms: null });
        continue;
      }
      try {
        measured.push({ name, ms: (await timed(read)).ms });
      } catch {
        measured.push({ name, ms: null });
      }
    }
    setTimings(measured);
    setIsMeasuring(false);
  }

  return (
    <View className="gap-3">
      <Text variant="h4" aria-level="2" className="text-base">
        Timings
      </Text>
      <View className="gap-3 rounded-lg border border-border bg-card p-4">
        <Text className="text-sm leading-5">
          Since the app&apos;s code started running. The time Metro takes to build and send the
          bundle comes before this and is not included.
        </Text>
        <View className="gap-1.5">
          {getStartupMarks().map((mark) => (
            <Row
              key={mark.name}
              label={mark.name}
              value={`${
                mark.duration === undefined
                  ? `at ${mark.at} ms`
                  : `${mark.duration} ms (done at ${mark.at} ms)`
              }${mark.count > 1 ? `, ${mark.count} times` : ''}`}
            />
          ))}
        </View>
        <Button
          variant="outline"
          className="h-12 self-start"
          disabled={isMeasuring}
          aria-busy={isMeasuring}
          onPress={() => void measure()}>
          {isMeasuring && <ActivityIndicator size="small" className="text-foreground" />}
          <Text>Measure screen queries</Text>
        </Button>
        {timings !== null && (
          <View accessibilityLiveRegion="polite" className="gap-1.5 border-t border-border pt-3">
            {timings.map((timing) => (
              <Row
                key={timing.name}
                label={timing.name}
                value={timing.ms === null ? 'Not available' : `${timing.ms.toFixed(1)} ms`}
              />
            ))}
          </View>
        )}
        <Text className="text-sm text-muted-foreground">
          This section appears only in development builds. Development builds run slower than a
          release build.
        </Text>
      </View>
    </View>
  );
}
