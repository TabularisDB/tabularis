/** Helpers for the connection environment classification (dev/staging/prod). */

export type ConnectionEnvironment = "development" | "staging" | "production";

interface EnvironmentConnection {
  id: string;
  environment?: ConnectionEnvironment;
}

export function isProductionConnection(
  connections: readonly EnvironmentConnection[],
  connectionId: string | null | undefined,
): boolean {
  return connections.some(
    (connection) =>
      connection.id === connectionId && connection.environment === "production",
  );
}

/** Tailwind classes for the environment badge chip, per tier. */
export const ENVIRONMENT_BADGE_CLASSES: Record<ConnectionEnvironment, string> = {
  development:
    "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  staging: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  production: "text-red-400 bg-red-400/10 border-red-400/20",
};

/** i18n key of the short badge label for an environment. */
export function environmentLabelKey(env: ConnectionEnvironment): string {
  return `environment.short.${env}`;
}
