/**
 * Exhaustiveness check for discriminated unions.
 *
 * The parameter typed `never` is the point: if a new variant is added to the
 * union and a `switch` stops covering it, the call stops compiling. The throw
 * is the runtime half, for values that arrive from outside the type system.
 */
export function unreachable(value: never, message?: string): never {
  throw new Error(
    message ?? `Unreachable: unexpected value ${JSON.stringify(value)}`
  );
}
