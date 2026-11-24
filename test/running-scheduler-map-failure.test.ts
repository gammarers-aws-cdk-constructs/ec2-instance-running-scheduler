import {
  failedInstanceIds,
  formatMapFailure,
  hasMapItemFailure,
  instanceIdFromTargetArn,
  MAP_FAILURE_NAME_LIMIT,
  namesForMapFailureMessage,
  notStartedMapCount,
} from '../src/funcs/core/running-scheduler-map-failure';

const ELEVEN_IDS = ['i-0', 'i-1', 'i-2', 'i-3', 'i-4', 'i-5', 'i-6', 'i-7', 'i-8', 'i-9', 'i-10'] as const;

describe('hasMapItemFailure', () => {
  it.each([
    [0, false],
    [1, true],
    [3, true],
  ] as const)('failureCount %i -> %s', (failureCount, expected) => {
    expect(hasMapItemFailure(failureCount)).toBe(expected);
  });
});

describe('notStartedMapCount', () => {
  it.each([
    [3, 3, 0],
    [5, 1, 4],
    [1, 4, 0],
  ] as const)('input %i recorded %i -> %i', (inputCount, recordedCount, expected) => {
    expect(notStartedMapCount(inputCount, recordedCount)).toBe(expected);
  });
});

describe('namesForMapFailureMessage', () => {
  it.each([
    [[], 10, [], 0],
    [['i-1', 'i-2'], 10, ['i-1', 'i-2'], 0],
    [['i-1', 'i-2', 'i-3'], 2, ['i-1', 'i-2'], 1],
    [['i-1'], 0, [], 1],
  ] as const)('keeps the first names and counts the rest', (names, limit, listed, omittedCount) => {
    expect(namesForMapFailureMessage(names, limit)).toEqual({ listed: [...listed], omittedCount });
  });
});

describe('instanceIdFromTargetArn', () => {
  it.each([
    ['arn:aws:ec2:ap-northeast-1:123456789012:instance/i-1', 'i-1'],
    ['i-short', 'i-short'],
    ['arn:aws:ec2:ap-northeast-1:123456789012:instance/', ''],
  ] as const)('%s -> %s', (targetResource, expected) => {
    expect(instanceIdFromTargetArn(targetResource)).toBe(expected);
  });
});

describe('failedInstanceIds', () => {
  const targets = ['arn:aws:ec2:ap-northeast-1:123456789012:instance/i-1', 'i-2'];

  it.each([
    [[0], ['i-1']],
    [[1], ['i-2']],
    [[0, 1], ['i-1', 'i-2']],
    [[5], ['5']],
  ] as const)('indexes %j -> %j', (indexes, expected) => {
    expect(failedInstanceIds(targets, indexes)).toEqual([...expected]);
  });
});

describe('formatMapFailure', () => {
  const capped = ELEVEN_IDS.slice(0, MAP_FAILURE_NAME_LIMIT).join(',');

  it.each([
    [
      ['i-1'],
      0,
      'ResourceWaitFailed:UnexpectedInstanceState',
      'MapFailed: names=i-1 omittedNames=0 notStarted=0 ResourceWaitFailed:UnexpectedInstanceState',
    ],
    [
      ELEVEN_IDS,
      0,
      'down',
      `MapFailed: names=${capped} omittedNames=1 notStarted=0 down`,
    ],
    [
      ['i-1'],
      2,
      '',
      'MapFailed: names=i-1 omittedNames=0 notStarted=2',
    ],
  ] as const)('includes the capped names, notStarted, and the child message', (names, notStarted, firstErrorMessage, expected) => {
    expect(formatMapFailure(names, notStarted, firstErrorMessage)).toBe(expected);
  });
});
