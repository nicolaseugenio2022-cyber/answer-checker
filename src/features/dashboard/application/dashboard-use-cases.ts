import {
  RECENT_LIMIT,
  localDayRange,
  type DashboardCounts,
  type DayRange,
  type LastScan,
  type RecentAnswerKey,
  type RecentResult,
} from '../domain/dashboard';

/**
 * Read-only access to what Home shows. Each method is one statement, however
 * many records are stored. Any method can fail with an error whose code is
 * `DATABASE_ERROR`.
 */
export type DashboardRepository = {
  /** Every count in one statement. `today` bounds the results counted as scanned today. */
  counts(today: DayRange): Promise<DashboardCounts>;
  /** The newest results, by capture time, then save time, then id. */
  recentResults(limit: number): Promise<RecentResult[]>;
  /** The answer keys created or changed most recently. */
  recentAnswerKeys(limit: number): Promise<RecentAnswerKey[]>;
  /** What the newest result was scanned with, or null when there is no result. */
  lastScan(): Promise<LastScan | null>;
};

/**
 * One reading of the dashboard. A part that could not be read is null, so the
 * parts that could be read are still shown; `lastScan` is also null when
 * nothing has been scanned.
 */
export type Dashboard = {
  counts: DashboardCounts | null;
  recentResults: RecentResult[] | null;
  recentAnswerKeys: RecentAnswerKey[] | null;
  lastScan: LastScan | null;
  /** True when at least one part could not be read. */
  isIncomplete: boolean;
};

type Dependencies = {
  repository: DashboardRepository;
  /** The current moment. The local calendar day is taken from it. */
  now?: () => Date;
};

export type DashboardUseCases = ReturnType<typeof createDashboardUseCases>;

export function createDashboardUseCases({ repository, now = () => new Date() }: Dependencies) {
  return {
    /**
     * Everything Home shows, read fresh. It never throws: a part that fails is
     * returned as null and reported through `isIncomplete`, so one failing
     * read does not take the rest of Home with it.
     */
    async getDashboard(): Promise<Dashboard> {
      const [counts, recentResults, recentAnswerKeys, lastScan] = await Promise.allSettled([
        repository.counts(localDayRange(now())),
        repository.recentResults(RECENT_LIMIT),
        repository.recentAnswerKeys(RECENT_LIMIT),
        repository.lastScan(),
      ]);
      const valueOf = <T>(outcome: PromiseSettledResult<T>): T | null =>
        outcome.status === 'fulfilled' ? outcome.value : null;
      return {
        counts: valueOf(counts),
        recentResults: valueOf(recentResults),
        recentAnswerKeys: valueOf(recentAnswerKeys),
        lastScan: valueOf(lastScan),
        isIncomplete: [counts, recentResults, recentAnswerKeys, lastScan].some(
          (outcome) => outcome.status === 'rejected'
        ),
      };
    },
  };
}
