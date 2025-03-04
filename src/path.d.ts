declare module 'path' {
  export function normalize(p: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...pathSegments: string[]): string;
  export function isAbsolute(p: string): boolean;
  export function relative(from: string, to: string): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function parse(p: string): {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  };
  export function format(pP: {
    root?: string;
    dir?: string;
    base?: string;
    ext?: string;
    name?: string;
  }): string;
  export const sep: string;
  export const delimiter: string;
  export const posix: {
    normalize(p: string): string;
    join(...paths: string[]): string;
    resolve(...pathSegments: string[]): string;
    isAbsolute(p: string): boolean;
    relative(from: string, to: string): string;
    dirname(p: string): string;
    basename(p: string, ext?: string): string;
    extname(p: string): string;
    parse(p: string): {
      root: string;
      dir: string;
      base: string;
      ext: string;
      name: string;
    };
    format(pP: {
      root?: string;
      dir?: string;
      base?: string;
      ext?: string;
      name?: string;
    }): string;
    sep: string;
    delimiter: string;
  };
  export const win32: {
    normalize(p: string): string;
    join(...paths: string[]): string;
    resolve(...pathSegments: string[]): string;
    isAbsolute(p: string): boolean;
    relative(from: string, to: string): string;
    dirname(p: string): string;
    basename(p: string, ext?: string): string;
    extname(p: string): string;
    parse(p: string): {
      root: string;
      dir: string;
      base: string;
      ext: string;
      name: string;
    };
    format(pP: {
      root?: string;
      dir?: string;
      base?: string;
      ext?: string;
      name?: string;
    }): string;
    sep: string;
    delimiter: string;
  };
}