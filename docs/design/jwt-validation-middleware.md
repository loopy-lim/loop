# Design: JWT validation middleware with signed tokens and expiry checks

Status: proposed (design task `design`, attempt 0)
Intent: "Implement JWT validation middleware with signed tokens and expiry checks"
Write scope honored: `docs/design/**` (this file)

## 1. Problem and scope

Loop needs request authentication for any surface that accepts requests on Loop's
behalf (a future local control-plane HTTP API, webhook-style triggers). This
design defines:

1. A pure JWT verification core: compact-JWS parsing, signature verification
   against an allowlisted algorithm set, and claim checks with mandatory
   `exp` enforcement.
2. The sanctioned TS↔Rust seam for calling it (bridge command + codegen).
3. A thin middleware contract (bearer extraction → verify → typed outcome)
   that any transport adapter composes.

Out of scope for v1: authorization/RBAC (scopes, roles), token issuance and
refresh flows, JWKS remote fetching, revocation lists. The design leaves a
`KeySource` seam so RS256/JWKS can land later without reshaping the core.

## 2. Assumptions and constraints

- **No HTTP surface exists today.** The middleware is specified as a
  transport-agnostic function; the first caller is expected to be a
  `Bun.serve` handler in the adapter/orchestrator layer. No HTTP server is
  added by this feature.
- **`loop-core` cannot host this.** `tests/architecture-boundaries.test.ts`
  pins `loop-core`'s `pub mod` list and forbids provider-adjacent concepts;
  authentication is not orchestration domain. Verification also must not live
  in TypeScript: deterministic policy belongs in Rust, and a TS verifier would
  hand-write a TS copy of a Rust domain type (forbidden).
- **Secrets never enter config files, logs, or persistence** (README
  invariant; `config/providers.example.toml` stores environment-variable
  *names* only). The same discipline applies to signing keys and tokens.

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | New leaf crate `crates/loop-auth`, depending on no other Loop crate | Pure, typed, unit-testable; sits beside `loop-core` at the bottom of the dependency graph; nothing it needs exists in core/store/bridge |
| D2 | Use the `jsonwebtoken` crate (pinned in `Cargo.lock`) inside `loop-auth`; do not hand-roll crypto | Boring, audited, deterministic; adding a published crates.io dependency matches the existing pinning policy |
| D3 | Expose verification to TS only via a `loop-bridge` command (`VerifyJwt`) and `bun run codegen` | Generated Rustra protocol is the only TS→Rust seam; Rust bridge types change first, generated files commit with the Rust change |
| D4 | Middleware is TS glue in the adapter/orchestrator layer: extract `Authorization: Bearer`, call `VerifyJwt`, map result to 401/principal | Keeps TS thin; no crypto or claim logic in TS |
| D5 | Algorithm allowlist v1: HS256 (primary). Reject `alg: none`, mismatched `alg`/`kid`, unknown `crit` | Single symmetric secret is sufficient for a local control plane; allowlist closes algorithm-confusion attacks |
| D6 | Claims policy: `exp` REQUIRED (reject if absent/invalid), `iss` and `aud` REQUIRED exact match, `nbf`/`iat` checked with leeway | Expiry is the stated requirement; default leeway 30s, configurable (non-secret value) in `config/auth.toml` |
| D7 | Clock is injected: verification takes `now_unix_secs` from the caller | Keeps `loop-auth` pure and testable; core/store never read the wall clock |
| D8 | Errors are a typed enum; HTTP mapping is 401 for every auth failure; error text never embeds the token, signature, or key | Uniform failure avoids oracle leaks; redaction discipline mirrors `packages/*/src/redact.ts` |

## 4. Component contracts

### 4.1 `crates/loop-auth` (Rust, pure)

```rust
pub struct JwtVerifier { /* algorithm allowlist, required iss/aud, leeway_secs */ }

pub enum AuthError {
    Malformed,        // not 3 dot-separated base64url segments, oversized (> 8 KiB)
    UnsupportedAlg,   // alg not in allowlist, or alg none
    BadSignature,     // signature check failed (constant-time compare for HMAC)
    Expired,          // exp < now - leeway
    NotYetValid,      // nbf > now + leeway
    BadIssuer,        // iss mismatch
    BadAudience,      // aud mismatch
    MissingClaim,     // required exp/iss/aud absent
}

pub struct VerifiedClaims { pub sub: String, pub expires_at_unix: i64 }

impl JwtVerifier {
    pub fn verify(&self, token: &str, key: &KeyMaterial, now_unix_secs: i64)
        -> Result<VerifiedClaims, AuthError>;
}

pub enum KeyMaterial { HmacSecret(Vec<u8>) /* zeroized on drop */ }
```

No I/O, no logging, no clock reads, no Loop-crate dependencies. Tests use
RFC 7515/7519 fixed vectors plus crafted expired/not-yet-valid/wrong-key/
`alg:none` cases — all offline, no paid calls.

### 4.2 `crates/loop-bridge` command (Rust boundary)

```rust
#[bridge_type] pub struct VerifyJwtInput  { token: String, issuer: String, audience: String, now_unix_secs: i64 }
#[bridge_type] pub struct VerifyJwtOutput { sub: String, expires_at_unix: i64 }
// failure surfaces as the existing bridge error channel carrying AuthError's discriminant
```

Flow per repo rule: change `crates/loop-bridge/src/commands.rs` first, run
`bun run codegen`, commit generated `packages/protocol/src/generated/**` with
the Rust change.

### 4.3 TS middleware (adapter/orchestrator layer)

```ts
// authenticateRequest(request, deps): Promise<AuthOutcome>
// AuthOutcome = { ok: true; principal: string } | { ok: false; status: 401 }
```

- Reads bearer token from `Authorization: Bearer <jwt>`; missing/invalid
  header shape → 401 without calling the bridge.
- Loads verifier settings (`issuer`, `audience`, leeway, env-var *name* for
  the HMAC secret) from `config/auth.toml` at composition root; the secret
  itself is resolved from the named environment variable only.
- Never logs the token, the `Authorization` header, or the secret; logging is
  limited to outcome + `sub`.
- ~60 lines; no claim inspection, no crypto.

### 4.4 Configuration (non-secret values only)

`config/auth.example.toml`:

```toml
[auth]
issuer = "loop"
audience = "loop-control-plane"
leeway_secs = 30
hmac_secret_env = "LOOP_AUTH_HMAC_SECRET"   # name only, never the value
```

## 5. Proposed task decomposition

Chain (serialized: each stage consumes the previous stage's types; no
overlapping writes, so no parallelism is worth the risk):

| id | kind | writes | depends on | completion checks |
| --- | --- | --- | --- | --- |
| `auth-core` | implementation | `crates/loop-auth/**`, root `Cargo.toml`, `Cargo.lock` | — | `cargo test -p loop-auth` |
| `auth-bridge` | implementation | `crates/loop-bridge/**`, `packages/protocol/src/generated/**` | `auth-core` | `cargo test -p loop-bridge` && `bun run codegen:check` |
| `auth-middleware` | implementation | `packages/orchestrator/src/**`, `config/**`, `packages/protocol/src/index.ts` (re-export only) | `auth-bridge` | `bun test packages/orchestrator` |
| `auth-verify` | verification | `packages/orchestrator/test/**`, `tests/**` | `auth-middleware` | `bun run check` |

`auth-verify` is the integration node: it proves end-to-end behavior with a
locally signed fixture token (accepted), and rejects expired, wrong-key,
wrong-audience, and `alg:none` tokens — all with fixed clocks, no network, no
paid model calls. If `tests/architecture-boundaries.test.ts` needs a new
assertion (e.g., `loop-auth` stays dependency-free), that assertion lands in
`auth-verify`, not earlier.

## 6. Security checklist (verified in `auth-verify`)

- `alg` allowlist enforced before signature check; `none` always rejected.
- Signature comparison is constant time (library-provided).
- Token size cap (8 KiB) rejects decompression/parse DoS.
- `exp` absence is a hard failure, not a pass.
- Leeway applies to `exp`/`nbf` symmetrically and is bounded (≤ 300s).
- Secrets exist only in process memory (zeroized `KeyMaterial`), env var, or
  OS keychain; never in `config/`, SQLite, events, or logs.
- Errors and logs never contain token material.

## 7. Risks and open questions

- **Integration point is provisional.** No HTTP server exists; if the first
  real consumer is Rust-side instead of TS-side, `auth-middleware` and
  `auth-bridge` collapse into a direct `loop-auth` call from that crate —
  D3's seam is then unnecessary but harmless.
- **Key rotation is undefined in v1.** Single static HMAC secret; rotation is
  manual (change env var, restart). A `kid`-keyed map is the v2 path.
- **New workspace member** (`crates/loop-auth`) touches `Cargo.toml` and may
  require regenerating `Cargo.lock`; keep that in the `auth-core` commit.
- **Dependency availability offline:** `jsonwebtoken` must be vendored/pinned
  like existing crates; if the environment forbids new crates.io pulls, fall
  back to RustCrypto `hmac` + `sha2` + `serde_json` (still pinned, still no
  hand-rolled TS).
- **Authorization (403) is explicitly deferred**; do not let middleware grow
  role checks in v1.
