import {
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
} from '../src/funcs/running-scheduler-polling-config';
import { parseResourcePollingLimitsFromEnv } from '../src/funcs/running-scheduler-polling-env';
import { DEFAULT_RESOURCE_POLLING_LIMITS } from '../src/funcs/running-scheduler-predicates';

const savedEnv = { ...process.env };

const restoreEnv = (): void => {
  process.env = { ...savedEnv };
};

const withEnv = (overrides: Record<string, string | undefined>, fn: () => void): void => {
  restoreEnv();
  delete process.env[PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV];
  delete process.env[PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    restoreEnv();
  }
};

describe('parseResourcePollingLimitsFromEnv', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('uses defaults when env vars are unset', () => {
    withEnv({}, () => {
      expect(parseResourcePollingLimitsFromEnv()).toEqual(DEFAULT_RESOURCE_POLLING_LIMITS);
    });
  });

  it('parses custom limits', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '10',
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: '600',
      },
      () => {
        expect(parseResourcePollingLimitsFromEnv()).toEqual({ maxLoopCount: 10, maxElapsedSeconds: 600 });
      },
    );
  });

  it('throws on invalid maxLoopCount', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '0',
      },
      () => {
        expect(() => parseResourcePollingLimitsFromEnv()).toThrow(/PROCESS_RESOURCE_MAX_LOOP_COUNT/);
      },
    );
  });

  it('throws on invalid maxElapsedSeconds', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: '-1',
      },
      () => {
        expect(() => parseResourcePollingLimitsFromEnv()).toThrow(/PROCESS_RESOURCE_MAX_ELAPSED_SECONDS/);
      },
    );
  });

  it('uses default for unset var when the other is set', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '15',
      },
      () => {
        expect(parseResourcePollingLimitsFromEnv()).toEqual({
          maxLoopCount: 15,
          maxElapsedSeconds: DEFAULT_RESOURCE_POLLING_LIMITS.maxElapsedSeconds,
        });
      },
    );
  });
});
