import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

export type LoggerConfig = {
  callback?: LoggerCallback;
  logs: boolean;
  levels?: LogLevel[];
};

export enum LogLevel {
  'debug' = 'debug',
  'error' = 'error',
  'info' = 'info',
  'log' = 'log',
  'warn' = 'warn',
};

export type LoggerCallback = (args: LogResult) => void;
export type LogMethod = (...args: any[]) => void;

export type LogResult = {
  level: string;
  message: string;
  args: any[];
};

export type CustomLogger = {
  debug: LogMethod;
  error: LogMethod;
  info: LogMethod;
  log: LogMethod;
  warn: LogMethod;
  logs: LogResult[];
};
