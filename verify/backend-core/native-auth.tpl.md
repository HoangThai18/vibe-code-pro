# Native app login (mobile, desktop): tokens, Apple/Google sign-in

Ran on Node 22 (TypeScript strict), PostgreSQL 16 (FORCE RLS, app role without BYPASSRLS), Express 5, jose 6, vitest 5: refresh-token reuse and parallel refreshes, Apple/Google ID tokens signed with local keys and served as a JWKS. Removing the family revocation or the nonce check failed a test. Web sessions, permissions and the rest of auth: `references/auth.md`.

Native apps send bearer tokens, not cookies. The `vibe-mobile` and `vibe-desktop` skills build on this exact contract:

| Request | Response |
|---|---|
| `POST /v1/auth/login` with `{ "email", "password" }` or `{ "provider": "apple" \| "google", "idToken", "nonce" }` | `200 { "data": { "accessToken", "refreshToken", "expiresIn" } }`; wrong credentials `401 invalid_credentials`; bad ID token `401 id_token_invalid` |
| `POST /v1/auth/refresh` with `{ "refreshToken" }` | `200`, same shape, with a **new** refresh token; spent, revoked, expired or unknown token → `401 { "error": { "code": "refresh_invalid", "message" } }` |
| `POST /v1/auth/logout` with `{ "refreshToken" }` | `204`, also for an unknown token |
| Every other request | headers `Authorization: Bearer <accessToken>`, `x-app-version: <semver>`, `x-app-platform: ios\|android\|macos\|windows\|linux`; too old → `426 app_update_required` (`references/api-conventions.md` section 8); expired access token → `401 unauthenticated`: refresh once, then retry |

- **Access token**: a JWT valid 15 minutes, holding only the user id (`sub`). The tenant stays in the path and membership is checked per request, so switching workspace needs no new token. **Refresh token**: 32 random bytes, stored as a SHA-256 hash, valid 30 days from its last rotation.
- **Rotation with reuse detection**: each refresh spends the token and issues a new one in the same family. A spent token presented again means a copy exists (stolen, or two refreshes in parallel): revoke the whole family, so both holders log in again. Apps must refresh once at a time (the `vibe-mobile` skill, `references/app-data.md` section 2).
- Logout revokes that device's family; password change, account lock and "log out everywhere" revoke every family of the user.
- **Apple/Google sign-in**: the app gets an ID token from the platform SDK; the server verifies its signature against the provider's published keys (JWKS), then issuer, audience (your client ids), age and nonce. Accounts are keyed by `(provider, sub)`, never by email alone; link to an existing account by email only when the provider marks it verified.
- **Nonce**: the app makes a random nonce per sign-in, passes its SHA-256 (hex) to the SDK and sends the raw value; a stolen ID token can't be replayed without it.
- The app keeps the refresh token in secure storage (Keychain, Keystore, OS credential store: the `vibe-mobile` and `vibe-desktop` skills), never in plain files.
- Browsers don't send bearer tokens on their own, so these endpoints need no CSRF protection. Never accept tokens in query strings: they end up in logs.

```sql
{{sql/native-auth.sql}}
```

```ts
{{src/auth/tokens.ts}}
```

```ts
{{src/auth/id-token.ts}}
```

```ts
{{src/auth/login.ts}}
```

```ts
{{src/auth/routes.ts}}
```

Tests (executed, `test/native-auth.test.ts`): the login response shape and that the token opens the API; the same 401 for a wrong password and an unknown email; 426 for an old app version; each refresh returns a new pair; reusing a spent token revokes the family; two parallel refreshes with one token give one 200, then the family is revoked; logout, unknown and expired tokens → 401; an ID token creates the user once and links by `sub`; another audience, another signing key, a wrong nonce, the hash sent as the raw nonce, or an expired token → 401; an unverified email is not linked to an existing account.

## Checklist

- [ ] Native apps: bearer access token, rotating refresh token with reuse detection, logout revokes the family
- [ ] Apple/Google ID tokens verified on the server (JWKS, issuer, audience, nonce); accounts keyed by `(provider, sub)`
