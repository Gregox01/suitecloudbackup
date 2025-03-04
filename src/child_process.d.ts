declare module 'child_process' {
  export interface ExecOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    encoding?: string;
    shell?: string;
    timeout?: number;
    maxBuffer?: number;
    killSignal?: string | number;
    uid?: number;
    gid?: number;
    windowsHide?: boolean;
  }

  export interface ExecException extends Error {
    cmd?: string;
    killed?: boolean;
    code?: number;
    signal?: string;
    stdout?: string;
    stderr?: string;
  }

  export interface ExecResult {
    stdout: string;
    stderr: string;
  }

  export function exec(command: string, options?: ExecOptions): ChildProcess;
  export function exec(command: string, callback: (error: ExecException | null, stdout: string, stderr: string) => void): ChildProcess;
  export function exec(command: string, options: ExecOptions, callback: (error: ExecException | null, stdout: string, stderr: string) => void): ChildProcess;

  export interface ChildProcess {
    stdin: NodeJS.WritableStream | null;
    stdout: NodeJS.ReadableStream | null;
    stderr: NodeJS.ReadableStream | null;
    killed: boolean;
    pid: number;
    connected: boolean;
    kill(signal?: string): boolean;
    send(message: any, callback?: (error: Error | null) => void): boolean;
    disconnect(): void;
    unref(): void;
    ref(): void;
  }
}

declare namespace NodeJS {
  type Buffer = any;

  interface ProcessEnv {
    [key: string]: string | undefined;
  }

  interface ReadableStream {
    read(size?: number): string | Buffer | null;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  interface WritableStream {
    write(buffer: Buffer | string, cb?: (err?: Error | null) => void): boolean;
    write(str: string, encoding?: string, cb?: (err?: Error | null) => void): boolean;
    end(cb?: () => void): void;
    end(data: string | Buffer, cb?: () => void): void;
    end(str: string, encoding?: string, cb?: () => void): void;
  }
}