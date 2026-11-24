/**
 * Pure helpers for a failed durable `map` of scheduler instances.
 *
 * The handler stays on the SDK default, which stops at the first failure.
 * These functions only shape the error text and the names that go into it.
 */

/** How many failed instance ids the thrown message lists. The log still has every id. */
export const MAP_FAILURE_NAME_LIMIT = 10;

/**
 * Whether the map recorded at least one failed item.
 *
 * @param failureCount - Failed items on the batch result. This is not the size of the input list.
 * @returns `true` when the run must throw.
 */
export const hasMapItemFailure = (failureCount: number): boolean => failureCount > 0;

/**
 * How many inputs were never recorded because the map stopped early.
 *
 * A recorded count larger than the input counts as zero. In-flight items that the
 * batch still lists count as recorded.
 *
 * @param inputCount - Instances passed to `map`.
 * @param recordedCount - Items present on the batch result.
 * @returns Inputs that do not appear in the batch result.
 */
export const notStartedMapCount = (inputCount: number, recordedCount: number): number =>
  Math.max(0, inputCount - recordedCount);

/** Failed names split between the thrown message and the count left out of it. */
export interface MapFailureMessageNames {
  /** Instance ids included in the thrown message, in the given order. */
  readonly listed: readonly string[];
  /** How many failed ids were left out of {@link MapFailureMessageNames.listed}. */
  readonly omittedCount: number;
}

/**
 * Keeps the first `limit` failed names for the thrown message.
 *
 * @param names - Failed instance ids, already ordered.
 * @param limit - Maximum names to include. Zero lists none.
 * @returns The listed names and how many were omitted.
 */
export const namesForMapFailureMessage = (
  names: readonly string[],
  limit: number,
): MapFailureMessageNames => ({
  listed: names.slice(0, Math.max(0, limit)),
  omittedCount: Math.max(0, names.length - Math.max(0, limit)),
});

/**
 * Instance id from a target ARN, or the whole string when it has no slash.
 *
 * @param targetResource - EC2 instance ARN, or a bare instance id.
 * @returns The last path segment. A trailing slash yields an empty string.
 */
export const instanceIdFromTargetArn = (targetResource: string): string => {
  const slash = targetResource.lastIndexOf('/');
  if (slash === -1) {
    return targetResource;
  }
  return targetResource.slice(slash + 1);
};

/**
 * Resolves failed map indexes to instance ids.
 *
 * @param targets - ARNs passed to `map`, in input order.
 * @param indexes - Indexes of failed items.
 * @returns One name per index. A missing target becomes the decimal index.
 */
export const failedInstanceIds = (
  targets: readonly string[],
  indexes: readonly number[],
): readonly string[] => indexes.map((index) => {
  const target = targets[index];
  if (target === undefined) {
    return String(index);
  }
  return instanceIdFromTargetArn(target);
});

/**
 * Builds the error thrown after a map failure.
 *
 * @param names - Every failed instance id, in index order.
 * @param notStarted - Inputs the map did not record.
 * @param firstErrorMessage - Message of the first failed item. Omitted from the text when empty.
 * @returns `MapFailed: names=... omittedNames=... notStarted=...` plus the child message when present.
 */
export const formatMapFailure = (
  names: readonly string[],
  notStarted: number,
  firstErrorMessage: string,
): string => {
  const { listed, omittedCount } = namesForMapFailureMessage(names, MAP_FAILURE_NAME_LIMIT);
  const summary = `MapFailed: names=${listed.join(',')} omittedNames=${omittedCount} notStarted=${notStarted}`;
  if (firstErrorMessage === '') {
    return summary;
  }
  return `${summary} ${firstErrorMessage}`;
};
