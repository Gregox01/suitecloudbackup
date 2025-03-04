declare module 'fs/promises' {
  export function readFile(path: string, options: { encoding: string; flag?: string } | string): Promise<string>;
  export function readFile(path: string, options?: { encoding?: null; flag?: string } | null): Promise<Buffer>;
  export function writeFile(path: string, data: string | Buffer, options?: { encoding?: string | null; mode?: number | string; flag?: string } | string | null): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean; mode?: number | string }): Promise<string | undefined>;
  export function stat(path: string): Promise<Stats>;
  export function readdir(path: string, options?: { encoding?: string | null; withFileTypes?: false } | string | null): Promise<string[]>;
  export function readdir(path: string, options: { encoding?: string | null; withFileTypes: true }): Promise<Dirent[]>;
  export function copyFile(src: string, dest: string, flags?: number): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;

  export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
  }

  export interface Dirent {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    name: string;
  }

  export type Buffer = any;
}