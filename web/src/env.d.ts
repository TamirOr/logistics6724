/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Short git SHA of the build. */
  readonly VITE_APP_VERSION?: string;
  /** Commit time of the build, Unix seconds; compared with min_client_version. */
  readonly VITE_APP_BUILT_AT?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
}
