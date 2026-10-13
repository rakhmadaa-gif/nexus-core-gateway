globalThis.Deno = {
  env: { get: (_n) => undefined },
  serve: (_opts, _handler) => ({ finished: Promise.resolve() }),
  cron: (_n, _e, _f) => {},
};
