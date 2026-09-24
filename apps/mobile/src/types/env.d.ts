// The client-safe allow-list (INTEGRATION_PLAN §15) typed as optional strings; Metro inlines these
// at bundle time. Any other key stays untyped on purpose: app code reads only these.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly EXPO_PUBLIC_SUPABASE_URL?: string;
      readonly EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
      readonly EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
      readonly EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string;
      readonly EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY?: string;
      readonly EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY?: string;
      readonly EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY?: string;
      readonly EXPO_PUBLIC_SENTRY_DSN?: string;
      readonly EXPO_PUBLIC_ANALYTICS_ENABLED?: string;
      readonly EXPO_PUBLIC_EAS_PROJECT_ID?: string;
      readonly EXPO_PUBLIC_APP_ENV?: string;
      readonly EXPO_PUBLIC_APP_SCHEME?: string;
      readonly EXPO_PUBLIC_WEB_URL?: string;
      readonly EXPO_PUBLIC_DEMO_MODE?: string;
    }
  }
}

export {};
