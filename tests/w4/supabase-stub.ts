const makeRow = () => ({
  id: "stub-id",
  client_id: "stub-client",
  tier: "standard",
  free_requests_left: 0,
  balance_credits: 0,
  total_invocations: 0,
  code_modules_trial_used: true,
  trial_expires_at: null,
});
const makeChain: any = () => {
  const p: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: any) => resolve({ data: [], error: null });
      if (prop === "single") return async () => ({ data: makeRow(), error: null });
      if (prop === "maybeSingle") return async () => ({ data: null, error: null });
      return (..._a: any[]) => makeChain();
    },
  });
  return p;
};
export const createClient = (_url: any, _key: any, _opts?: any) => ({
  from: (_t: any) => makeChain(),
  rpc: (_n: any, _a?: any) => makeChain(),
});
