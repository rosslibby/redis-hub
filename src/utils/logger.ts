import util from 'util';
import {
  LoggerCallback,
  LoggerConfig,
  LogLevel,
  LogMethod,
  LogResult,
} from '../types';

const _console: Record<LogLevel, (...args: any[]) => void> = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
};

/**
 * Logger with in-memory history, optional console output,
 * and user-supplied callback support. Supports filtering by level.
 */
export class Logger {
  private callback: LoggerCallback | null = null;
  private logging: boolean = true;
  public logs: LogResult[] = [];
  private levels?: LogLevel[];
  public debug: LogMethod = this.run.bind(this, LogLevel.debug);
  public error: LogMethod = this.run.bind(this, LogLevel.error);
  public info: LogMethod = this.run.bind(this, LogLevel.info);
  public log: LogMethod = this.run.bind(this, LogLevel.log);
  public warn: LogMethod = this.run.bind(this, LogLevel.warn);

  /**
   * @param props.logging - Whether logs are echoed to console. Defaults to true.
   * @param props.logLevels - If provided, only these levels will be output.
   * @param props.callback - Optional function invoked with every log entry.
   */
  constructor(props?: {
    logging?: boolean;
    logLevels?: LogLevel[];
    callback?: LoggerCallback;
  }) {
    this.logs = [];
    if (typeof props?.logging !== 'undefined') {
      this.logging = props.logging;
    }
    if (typeof props?.callback !== 'undefined') {
      this.callback = props.callback;
    }
    if (typeof props?.logLevels !== 'undefined') {
      this.levels = props.logLevels;
    }
  }

  public setup({ callback, logs, levels }: LoggerConfig): void {
    this.callback = callback ?? null;
    this.logging = logs;
    this.levels = levels;
  }

  /**
   * Internal output to console respecting level filters.
   * @private
   */
  private output(level: LogLevel, ...args: any[]): void {
    if (!this.logging || (this.levels && !this.levels.includes(level))) {
      return;
    }

    _console[level](...args);
  }

  /**
   * Core log runner; formats the message, stores it, invokes callback, and outputs.
   * @private
   */
  private run(level: LogLevel, ...args: any[]): void {
    const message = util.format(...args)
    const result: LogResult = { args, level, message };
    this.logs.push(result);
    this.callback?.(result);
    this.output(level, ...args);
  }
}
