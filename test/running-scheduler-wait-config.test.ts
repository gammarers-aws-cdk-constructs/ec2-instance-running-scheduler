import { DEFAULT_MAX_CONCURRENCY, DEFAULT_RESOURCE_WAIT_LIMITS } from '../src/funcs/running-scheduler-predicates';
import {
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV,
  PROCESS_RESOURCES_MAX_CONCURRENCY_ENV,
} from '../src/funcs/running-scheduler-wait-config';
import { parseMaxConcurrencyFromEnv, parseResourceWaitLimitsFromEnv } from '../src/funcs/running-scheduler-wait-env';

const savedEnv = { ...process.env };

const HANDLER_ENV_KEYS = [
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV,
  PROCESS_RESOURCES_MAX_CONCURRENCY_ENV,
] as const;

const restoreEnv = (): void => {
  process.env = { ...savedEnv };
};

const withEnv = (overrides: Record<string, string | undefined>, fn: () => void): void => {
  restoreEnv();
  for (const key of HANDLER_ENV_KEYS) {
    delete process.env[key];
  }
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

describe('parseResourceWaitLimitsFromEnv', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('uses defaults when env vars are unset', () => {
    withEnv({}, () => {
      expect(parseResourceWaitLimitsFromEnv()).toEqual(DEFAULT_RESOURCE_WAIT_LIMITS);
    });
  });

  it('parses custom limits', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '10',
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: '600',
        [PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV]: '5',
      },
      () => {
        expect(parseResourceWaitLimitsFromEnv()).toEqual({
          maxLoopCount: 10,
          maxElapsedSeconds: 600,
          statusChangeWaitSeconds: 5,
        });
      },
    );
  });

  it('throws on invalid maxLoopCount', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '0',
      },
      () => {
        expect(() => parseResourceWaitLimitsFromEnv()).toThrow(/PROCESS_RESOURCE_MAX_LOOP_COUNT/);
      },
    );
  });

  it('throws on invalid maxElapsedSeconds', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: '-1',
      },
      () => {
        expect(() => parseResourceWaitLimitsFromEnv()).toThrow(/PROCESS_RESOURCE_MAX_ELAPSED_SECONDS/);
      },
    );
  });

  it('throws on invalid statusChangeWaitSeconds', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV]: '0',
      },
      () => {
        expect(() => parseResourceWaitLimitsFromEnv()).toThrow(/PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS/);
      },
    );
  });

  it('uses default for unset var when the other is set', () => {
    withEnv(
      {
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: '15',
      },
      () => {
        expect(parseResourceWaitLimitsFromEnv()).toEqual({
          maxLoopCount: 15,
          maxElapsedSeconds: DEFAULT_RESOURCE_WAIT_LIMITS.maxElapsedSeconds,
          statusChangeWaitSeconds: DEFAULT_RESOURCE_WAIT_LIMITS.statusChangeWaitSeconds,
        });
      },
    );
  });
});

describe('parseMaxConcurrencyFromEnv', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('uses default when env var is unset', () => {
    withEnv({}, () => {
      expect(parseMaxConcurrencyFromEnv()).toBe(DEFAULT_MAX_CONCURRENCY);
    });
  });

  it('parses custom concurrency', () => {
    withEnv(
      {
        [PROCESS_RESOURCES_MAX_CONCURRENCY_ENV]: '25',
      },
      () => {
        expect(parseMaxConcurrencyFromEnv()).toBe(25);
      },
    );
  });

  it('throws on invalid maxConcurrency', () => {
    withEnv(
      {
        [PROCESS_RESOURCES_MAX_CONCURRENCY_ENV]: '0',
      },
      () => {
        expect(() => parseMaxConcurrencyFromEnv()).toThrow(/PROCESS_RESOURCES_MAX_CONCURRENCY/);
      },
    );
  });
});
