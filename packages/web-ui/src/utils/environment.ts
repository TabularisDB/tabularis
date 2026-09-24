/** Helpers for the connection environment classification (dev/staging/prod). */
import type { Tone } from "./tones";

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
export const ENVIRONMENT_TONES: Record<ConnectionEnvironment, Tone> = {
  development: "success",
  staging: "warning",
  production: "danger",
};

/** i18n key of the short badge label for an environment. */
export function environmentLabelKey(env: ConnectionEnvironment): string {
  return `environment.short.${env}`;
}
