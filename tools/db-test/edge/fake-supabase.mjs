// Fake supabase-js client for tools/db-test/edge/run.mjs + run-push.mjs. Records every RPC call;
// nc_alert_claim / nc_push_claim return whatever globalThis.__claim / __pushClaim(args) return; globalThis.__legacy
// simulates the pre-wave-3 SQL signatures (PGRST202 for p_actor / p_reason).
export const calls = [];

export function createClient() {
  return {
    auth: {
      async getUser(jwt) {
        return jwt === 'admin-jwt' || jwt === 'user-jwt'
          ? { data: { user: { id: jwt === 'admin-jwt' ? 'admin-1' : 'user-1' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } };
      }
    },
    from() {
      let userId = null;
      const q = {
        select() { return q; },
        eq(col, value) { if (col === 'user_id') userId = value; return q; },
        async maybeSingle() { return { data: userId === 'admin-1' ? { user_id: userId } : null, error: null }; }
      };
      return q;
    },
    async rpc(fn, args) {
      calls.push({ fn, args });
      // globalThis.__legacy: database without migration 20260928000100 (no p_actor / p_reason)
      if (globalThis.__legacy && ('p_actor' in args || 'p_reason' in args)) {
        return { data: null, error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
      }
      if (fn === 'nc_alert_claim') return { data: globalThis.__claim(args), error: null };
      if (fn === 'nc_push_claim') return { data: globalThis.__pushClaim ? globalThis.__pushClaim(args) : [], error: null };
      return { data: { ok: true }, error: null };
    }
  };
}
