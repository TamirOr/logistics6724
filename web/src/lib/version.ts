// The build this app runs. The deploy workflow sets both from git: the short
// SHA names the build, the commit time (Unix seconds) orders builds, since
// SHAs cannot be compared. Local builds are "dev" and 0.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || "dev";
export const APP_BUILT_AT: number = Number(import.meta.env.VITE_APP_BUILT_AT) || 0;

/**
 * True when app_config.min_client_version (a commit time) is newer than this
 * build: the schema changed in a way this build cannot write to. Local
 * builds are never blocked.
 */
export function isOutdated(builtAt: number, minVersion: string | null | undefined): boolean {
  const min = Number(minVersion);
  return builtAt > 0 && Number.isFinite(min) && builtAt < min;
}
