import {
  parseResourcePollingLimitsFromEnv,
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
} from '../src/funcs/running-scheduler-polling-config';
import { DEFAULT_RESOURCE_POLLING_LIMITS } from '../src/funcs/running-scheduler-predicates';

describe('parseResourcePollingLimitsFromEnv', () => {
  it('uses defaults when env vars are unset', () => {
    expect(parseResourcePollingLimitsFromEnv({})).toEqual(DEFAULT_RESOURCE_POLLING_LIMITS);
  });

  it('parses custom limits', () => {
    expect(
      parseResourcePollingLimitsFromEnv({
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '10',
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: '600',
      }),
    ).toEqual({ maxLoopCount: 10, maxElapsedSeconds: 600 });
  });

  it('throws on invalid maxLoopCount', () => {
    expect(() =>
      parseResourcePollingLimitsFromEnv({
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '0',
      }),
    ).toThrow(/PROCESS_RESOURCE_MAX_LOOP_COUNT/);
  });

  it('throws on invalid maxElapsedSeconds', () => {
    expect(() =>
      parseResourcePollingLimitsFromEnv({
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: '-1',
      }),
    ).toThrow(/PROCESS_RESOURCE_MAX_ELAPSED_SECONDS/);
  });

  it('uses default for unset var when the other is set', () => {
    expect(
      parseResourcePollingLimitsFromEnv({
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '15',
      }),
    ).toEqual({
      maxLoopCount: 15,
      maxElapsedSeconds: DEFAULT_RESOURCE_POLLING_LIMITS.maxElapsedSeconds,
    });
  });
});
