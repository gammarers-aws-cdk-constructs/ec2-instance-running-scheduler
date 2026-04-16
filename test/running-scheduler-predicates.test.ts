import { isDesiredStableState } from '../src/funcs/running-scheduler-predicates';

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
