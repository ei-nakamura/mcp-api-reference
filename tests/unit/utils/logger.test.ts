import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger } from '../../../src/utils/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('is instantiated with log level', () => {
    const logger = new Logger('warn');
    expect(logger).toBeInstanceOf(Logger);
  });

  it('respects level filtering: debug < info < warn < error', () => {
    const logger = new Logger('warn');
    logger.debug('debug msg');
    logger.info('info msg');
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.warn('warn msg');
    logger.error('error msg');
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('does NOT write to stderr when level is below threshold', () => {
    const logger = new Logger('error');
    logger.debug('below');
    logger.info('below');
    logger.warn('below');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('DOES write to stderr at or above threshold', () => {
    const logger = new Logger('info');
    logger.info('info msg');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain('info msg');

    logger.warn('warn msg');
    logger.error('error msg');
    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it('createLogger() creates a Logger instance', () => {
    const logger = createLogger('debug');
    expect(logger).toBeInstanceOf(Logger);
  });
});
