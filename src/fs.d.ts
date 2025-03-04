declare module 'fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number | string }): string | undefined;
  export function readFileSync(path: string, options: { encoding: string; flag?: string } | string): string;
  export function readFileSync(path: string, options?: { encoding?: null; flag?: string } | null): Buffer;
  export function writeFileSync(path: string, data: string | Buffer, options?: { encoding?: string | null; mode?: number | string; flag?: string } | string | null): void;
  export function statSync(path: string): Stats;
  export function readdirSync(path: string, options?: { encoding?: string | null; withFileTypes?: false } | string | null): string[];
  export function readdirSync(path: string, options: { encoding?: string | null; withFileTypes: true }): Dirent[];

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