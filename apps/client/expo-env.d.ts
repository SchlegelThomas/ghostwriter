/**
 * Metro inlines EXPO_PUBLIC_* at build time. Declare only what the client reads
 * so typecheck does not depend on a hoisted @types/node from other packages.
 */
declare const process: {
  readonly env: {
    readonly EXPO_PUBLIC_API_URL?: string;
    readonly EXPO_PUBLIC_APP_URL?: string;
  };
};
