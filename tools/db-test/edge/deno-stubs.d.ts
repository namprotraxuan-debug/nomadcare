// Minimal type stubs so `tsc` can type-check supabase/functions/deadman-alert/index.ts and
// push-dispatch/index.ts without a Deno toolchain (tools/db-test/edge/run.sh). Only the APIs they use.
declare module "jsr:@supabase/functions-js/edge-runtime.d.ts" {}
declare module "npm:@supabase/supabase-js@2" {
  interface PgError { message: string }
  interface Query {
    eq(column: string, value: unknown): Query;
    maybeSingle(): Promise<{ data: unknown; error: PgError | null }>;
  }
  export interface SupabaseClient {
    auth: {
      getUser(jwt?: string): Promise<{ data: { user: { id: string; email?: string } | null }; error: PgError | null }>;
    };
    from(table: string): { select(columns: string): Query };
    // deno-lint-ignore no-explicit-any
    rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: any; error: PgError | null }>;
  }
  export function createClient(url: string, key: string, options?: unknown): SupabaseClient;
}
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};
declare module "npm:web-push@3" {
  interface PushSubscriptionLike { endpoint: string; keys: { p256dh: string; auth: string } }
  interface SendOptions { TTL?: number; urgency?: "very-low" | "low" | "normal" | "high"; timeout?: number; topic?: string }
  interface SendResult { statusCode: number; body: string; headers: Record<string, string> }
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(sub: PushSubscriptionLike, payload?: string, options?: SendOptions): Promise<SendResult>;
  };
  export default webpush;
}
