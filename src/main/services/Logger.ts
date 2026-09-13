import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import { LogLevel } from '../../shared/types';

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  off: 4
};

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BACKUP_FILES = 3;

/**
 * Service responsible for persistent diagnostic logging to disk.
 * Supports configurable log levels, automatic size-based log rotation,
 * asynchronous non-blocking queueing, and cross-process log ingestion.
 */
export class Logger {
  private logDir: string;
  private logFilePath: string;
  private currentLevel: LogLevel = 'info';
  private writeQueue: string[] = [];
  private isWriting = false;

  constructor(userDataPath: string, initialLevel: LogLevel = 'info') {
    this.logDir = path.join(userDataPath, 'logs');
    this.logFilePath = path.join(this.logDir, 'karaoke-station.log');
    this.currentLevel = initialLevel;

    this.ensureDirectory();
    this.info('Logger', 'Diagnostic logging system initialized', {
      logFilePath: this.logFilePath,
      level: this.currentLevel
    });
  }

  /**
   * Ensures the target logging directory exists.
   */
  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('[Logger] Failed to create log directory:', err);
    }
  }

  /**
   * Updates the active minimum logging level at runtime.
   */
  public setLogLevel(level: LogLevel): void {
    if (this.currentLevel === level) return;
    const oldLevel = this.currentLevel;
    this.currentLevel = level;
    this.info('Logger', `Log level changed from ${oldLevel} to ${level}`);
  }

  /**
   * Returns current active log level.
   */
  public getLogLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * Returns the absolute path of the active log file.
   */
  public getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Returns the absolute path of the logging directory.
   */
  public getLogFolderPath(): string {
    return this.logDir;
  }

  /**
   * Checks whether a message at the given level should be logged.
   */
  private shouldLog(level: LogLevel): boolean {
    if (this.currentLevel === 'off') return false;
    return LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[this.currentLevel];
  }

  /**
   * Formats a date to local ISO-like string [YYYY-MM-DD HH:mm:ss.SSS].
   */
  private formatTimestamp(d = new Date()): string {
    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    const ms = pad(d.getMilliseconds(), 3);
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
  }

  /**
   * Serializes arbitrary metadata or Error objects safely.
   */
  private serializeData(data: unknown): string {
    if (data === undefined) return '';
    if (data instanceof Error) {
      return ` | Error: ${data.message} ${data.stack ? `\nStack: ${data.stack}` : ''}`;
    }
    if (typeof data === 'object' && data !== null) {
      try {
        return ` | Data: ${JSON.stringify(data)}`;
      } catch {
        return ` | Data: [Unserializable Object]`;
      }
    }
    return ` | Data: ${String(data)}`;
  }

  /**
   * Core logging method.
   */
  public log(level: LogLevel, source: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const timestamp = this.formatTimestamp();
    const levelTag = level.toUpperCase().padEnd(5);
    const serialized = this.serializeData(data);
    const line = `[${timestamp}] [${levelTag}] [${source}] ${message}${serialized}\n`;

    // Also output to dev console
    if (level === 'error') {
      console.error(`[${levelTag}] [${source}] ${message}`, data !== undefined ? data : '');
    } else if (level === 'warn') {
      console.warn(`[${levelTag}] [${source}] ${message}`, data !== undefined ? data : '');
    } else {
      console.log(`[${levelTag}] [${source}] ${message}`, data !== undefined ? data : '');
    }

    this.enqueue(line);
  }

  public debug(source: string, message: string, data?: unknown): void {
    this.log('debug', source, message, data);
  }

  public info(source: string, message: string, data?: unknown): void {
    this.log('info', source, message, data);
  }

  public warn(source: string, message: string, data?: unknown): void {
    this.log('warn', source, message, data);
  }

  public error(source: string, message: string, data?: unknown): void {
    this.log('error', source, message, data);
  }

  /**
   * Enqueues a formatted line and flushes the write queue.
   */
  private enqueue(line: string): void {
    this.writeQueue.push(line);
    if (!this.isWriting) {
      this.processQueue();
    }
  }

  /**
   * Asynchronously drains the write queue to disk with rotation checks.
   */
  private async processQueue(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) return;
    this.isWriting = true;

    try {
      await this.rotateIfNeeded();

      const chunk = this.writeQueue.join('');
      this.writeQueue = [];

      await fs.promises.appendFile(this.logFilePath, chunk, 'utf8');
    } catch (err) {
      console.error('[Logger] Failed to write logs to disk:', err);
    } finally {
      this.isWriting = false;
      if (this.writeQueue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  /**
   * Rotates log files if the primary log exceeds MAX_LOG_SIZE_BYTES.
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      if (!fs.existsSync(this.logFilePath)) return;

      const stat = await fs.promises.stat(this.logFilePath);
      if (stat.size < MAX_LOG_SIZE_BYTES) return;

      // Rotate older backups: .log.2 -> .log.3, .log.1 -> .log.2
      for (let i = MAX_BACKUP_FILES - 1; i >= 1; i--) {
        const src = `${this.logFilePath}.${i}`;
        const dest = `${this.logFilePath}.${i + 1}`;
        if (fs.existsSync(src)) {
          try {
            await fs.promises.rename(src, dest);
          } catch {
            // Ignore rename collision
          }
        }
      }

      // Rename current log to .log.1
      const firstBackup = `${this.logFilePath}.1`;
      await fs.promises.rename(this.logFilePath, firstBackup);
    } catch (err) {
      console.error('[Logger] Log rotation failed:', err);
    }
  }

  /**
   * Reads the most recent N lines from the active log file.
   */
  public async getRecentLogs(maxLines = 200): Promise<string[]> {
    try {
      if (!fs.existsSync(this.logFilePath)) return [];
      const content = await fs.promises.readFile(this.logFilePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(-maxLines);
    } catch (err) {
      console.error('[Logger] Failed to read recent logs:', err);
      return [];
    }
  }

  /**
   * Empties the current log file.
   */
  public async clearLogs(): Promise<boolean> {
    try {
      this.writeQueue = [];
      await fs.promises.writeFile(this.logFilePath, '', 'utf8');
      this.info('Logger', 'Log file was cleared by user');
      return true;
    } catch (err) {
      console.error('[Logger] Failed to clear log file:', err);
      return false;
    }
  }

  /**
   * Opens the directory containing log files in the OS file manager.
   */
  public async openLogFolder(): Promise<void> {
    this.ensureDirectory();
    await shell.openPath(this.logDir);
  }

  /**
   * Opens the current log file in the user's default text viewer.
   */
  public async openLogFile(): Promise<void> {
    this.ensureDirectory();
    if (!fs.existsSync(this.logFilePath)) {
      await fs.promises.writeFile(this.logFilePath, '', 'utf8');
    }
    await shell.openPath(this.logFilePath);
  }
}
