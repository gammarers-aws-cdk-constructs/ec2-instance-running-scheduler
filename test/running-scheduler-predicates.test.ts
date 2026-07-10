import {
  formatResourceWaitFailure,
  getWaitAbortReason,
  isDesiredStableState,
  isTransitioningState,
} from '../src/funcs/running-scheduler-predicates';

describe('isDesiredStableState', () => {
  it.each([
    ['Start', 'running', true],
    ['Start', 'stopped', false],
    ['Start', 'pending', false],
    ['Stop', 'stopped', true],
    ['Stop', 'running', false],
    ['Stop', 'stopping', false],
  ] as const)('mode %s and state %s -> %s', (mode, currentState, expected) => {
    expect(isDesiredStableState(mode, currentState)).toBe(expected);
  });
});

describe('isTransitioningState', () => {
  it.each([
    ['Start', 'pending', true],
    ['Start', 'running', false],
    ['Stop', 'stopping', true],
    ['Stop', 'shutting-down', true],
    ['Stop', 'stopped', false],
  ] as const)('mode %s and state %s -> %s', (mode, currentState, expected) => {
    expect(isTransitioningState(mode, currentState)).toBe(expected);
  });
});

describe('getWaitAbortReason', () => {
  const limits = { maxLoopCount: 3, maxElapsedSeconds: 100 };
  const startedAtMs = 1_000_000;

  it.each([
    [0, startedAtMs, startedAtMs, undefined],
    [2, startedAtMs, startedAtMs + 99_000, undefined],
    [3, startedAtMs, startedAtMs, 'MaxLoopCountExceeded'],
    [0, startedAtMs, startedAtMs + 100_000, 'MaxElapsedTimeExceeded'],
  ] as const)(
    'loopCount=%i now-start=%ims -> %s',
    (loopCount, startedAt, now, expected) => {
      expect(getWaitAbortReason(loopCount, startedAt, now, limits)).toBe(expected);
    },
  );
});

describe('formatResourceWaitFailure', () => {
  const context = {
    identifier: 'i-abc',
    mode: 'Start' as const,
    currentState: 'pending',
    loopCount: 3,
    limits: { maxLoopCount: 90, maxElapsedSeconds: 1800 },
  };

  it('formats MaxLoopCountExceeded', () => {
    expect(formatResourceWaitFailure('MaxLoopCountExceeded', context)).toBe(
      'ResourceWaitFailed:MaxLoopCountExceeded: identifier=i-abc mode=Start currentState=pending loopCount=3 maxLoopCount=90',
    );
  });

  it('formats MaxElapsedTimeExceeded', () => {
    expect(formatResourceWaitFailure('MaxElapsedTimeExceeded', context)).toBe(
      'ResourceWaitFailed:MaxElapsedTimeExceeded: identifier=i-abc mode=Start currentState=pending loopCount=3 maxElapsedSeconds=1800',
    );
  });

  it('formats UnexpectedInstanceState', () => {
    expect(formatResourceWaitFailure('UnexpectedInstanceState', context)).toContain(
      'ResourceWaitFailed:UnexpectedInstanceState:',
    );
  });
});
