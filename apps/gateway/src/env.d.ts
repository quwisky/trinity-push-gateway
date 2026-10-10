// Secrets are not part of wrangler.jsonc, so `wrangler types` does not generate
// them. Declared here on both the global `Env` and `Cloudflare.Env` (the type of
// `env` from `cloudflare:workers`) so the two stay assignable to each other.
//
// `PUSHKEY_LIMITER` stays required as generated: an interface that extends the
// generated base cannot loosen a property to optional. Code that reads it must
// treat it as possibly undefined (it is absent when the binding is not configured).
declare namespace Cloudflare {
  interface Env {
    FCM_SERVICE_ACCOUNT: string;
  }
}

interface Env {
  FCM_SERVICE_ACCOUNT: string;
}
