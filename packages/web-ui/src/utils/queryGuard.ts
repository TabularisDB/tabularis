export interface QueryGuardPipeline {
  guardProduction: () => Promise<boolean>;
  guardDangerousQuery: () => Promise<boolean>;
}

/**
 * Runs query safety checks in priority order. Production gets the first chance
 * to block the operation; the standard dangerous-query guard runs afterwards.
 */
export async function passQueryGuards({
  guardProduction,
  guardDangerousQuery,
}: QueryGuardPipeline): Promise<boolean> {
  if (!(await guardProduction())) return false;
  return guardDangerousQuery();
}
