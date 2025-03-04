declare module 'util' {
  export function promisify<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => Promise<any>;
  export function inspect(object: any, showHidden?: boolean, depth?: number | null, color?: boolean): string;
  export function isArray(object: any): object is any[];
  export function isBoolean(object: any): object is boolean;
  export function isBuffer(object: any): boolean;
  export function isDate(object: any): object is Date;
  export function isError(object: any): object is Error;
  export function isFunction(object: any): boolean;
  export function isNull(object: any): object is null;
  export function isNullOrUndefined(object: any): object is null | undefined;
  export function isNumber(object: any): object is number;
  export function isObject(object: any): boolean;
  export function isPrimitive(object: any): boolean;
  export function isRegExp(object: any): object is RegExp;
  export function isString(object: any): object is string;
  export function isSymbol(object: any): object is symbol;
  export function isUndefined(object: any): object is undefined;
}