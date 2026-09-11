/** Undefined preserves legacy loading; only an explicit false skips the RPC. */
export function loadOptionalMetadata<T>(
  supported: boolean | undefined,
  load: () => Promise<T>,
  empty: T,
): Promise<T> {
  return supported === false ? Promise.resolve(empty) : load();
}
