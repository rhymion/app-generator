# OWASP ASVS 5.0 coverage

This table maps each requirement of the [OWASP Application Security Verification Standard 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0_release) at Level 2 to how this generator and the apps it generates cover it. Requirements are identified by their ASVS identifier; read the requirement text in the standard. Audit logging (chapter V16) and authorization (chapter V8, which holds the organization-isolation requirements) are assessed up to Level 3. The tracking Issue is #1233.

The table describes what is verified in this repository today. A row never claims more than its "Verified by" column shows: `none` means the behavior was read in code or a document but no test proves it.

## Status values

| Status | Meaning |
|--------|---------|
| generator | Generated code or generator code implements it. "Covered by" names the code path. |
| framework | Next.js, React, Prisma or Auth.js guarantees it. "Source and version" names the package and the version checked; re-check the row when that package is upgraded. |
| environment | A deployment or platform setting provides it. "Covered by" names the script or document, or states that the platform decides. |
| n/a | The requirement does not apply. "Covered by" gives the reason. |
| gap | Not covered. "Gap Issue" links the Issue that tracks it. |

A `generator`, `framework` or `environment` row can also list a Gap Issue when the coverage is partial; the Issue tracks the missing part.

## Maintaining the table

- One row per requirement; keep the column order so rows can be sorted, filtered and extended.
- When an Issue in the "Gap Issue" column is closed, change the row to the status it now has and fill "Verified by".
- When a package in "Source and version" is upgraded, re-check its rows against the package documentation and update the version.
- `code_generator/tests/test_asvs_coverage_table.py` checks this file: every in-scope requirement appears exactly once, every `gap` row links an Issue, every `framework` row names a source and a version, and no cell is empty.
- Tests that prove the framework-guaranteed rows live in `cypress/e2e/api/framework_guarantees.cy.ts` and run in the mandatory API gate (`npm run test:e2e:cy:api`). The Auth.js OAuth `state` and PKCE checks cannot be exercised there, because the end-to-end stack replaces the Google provider with a mock (`lib/auth/mock-oauth-gate.ts`); #1234 tracks them.

Related documents: [security-test-matrix.md](security-test-matrix.md), [authentication.md](authentication.md), [authorization-default-deny.md](authorization-default-deny.md), [api-idempotency-and-rate-limiting.md](api-idempotency-and-rate-limiting.md), [ci-security-workflows.md](ci-security-workflows.md).

Chapter V17 (WebRTC) does not apply: the generated app has no real-time media, TURN, signaling or DTLS/SRTP code or dependency.


## V1 Encoding and Sanitization

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V1.1.1 | 2 | framework | Routes read the body once with request.json(); no decode after validation found | none | - | next 16.4.2 (package-lock.json); Route Handlers docs |
| V1.1.2 | 2 | framework | React JSX escaping, Prisma parameter binding, escapeCSV in lib/_csv.ts | none | #1273 | react 19.3.1 (package-lock.json); JSX escaping docs |
| V1.2.1 | 1 | framework | React JSX escaping; no dangerouslySetInnerHTML in app, components or templates | components/_standard/ListWrapper.test.tsx, EditableListWrapper.test.tsx | - | react 19.3.1 (package-lock.json); JSX escaping docs |
| V1.2.2 | 1 | generator | lib/_safe_url.ts isSafeUrl; lib/auth/safe-redirect.ts | lib/_safe_url.test.ts, lib/auth/safe-redirect.test.ts | - | - |
| V1.2.3 | 1 | framework | React JSX escaping; NextResponse.json serializes JSON; no inline script construction found | none | - | next 16.4.2 (package-lock.json); NextResponse.json |
| V1.2.4 | 1 | generator | Prisma query builder; docs/knowledge/raw-sql-policy.md; check_generated.py raw:* rules | code_generator/tests/test_sql_safety.py (skips in CI), gate step 16 check:generated | - | - |
| V1.2.5 | 1 | n/a | The app runtime executes no OS commands (no child_process use in lib or templates) | none | - | - |
| V1.2.6 | 2 | n/a | No LDAP usage | none | - | - |
| V1.2.7 | 2 | n/a | No XPath or XML querying in the app | none | - | - |
| V1.2.8 | 2 | n/a | No LaTeX processing | none | - | - |
| V1.2.9 | 2 | generator | lib/mention/parser.ts escapeRegExp before new RegExp; one other dynamic RegExp in lib/legal/content.ts was not traced to its input | none | #1273 | - |
| V1.3.1 | 1 | n/a | No WYSIWYG or user HTML input; comments are plain text | none | - | - |
| V1.3.2 | 1 | gap | No gate rule forbids eval or new Function; the only eval hit is a Redis Lua call in lib/rate-limit/redis.ts | none | #1247 | - |
| V1.3.3 | 2 | generator | lib/_upload_validation.ts allow-list; lib/_safe_url.ts; CSV import checks | lib/_upload_validation.test.ts, cypress/e2e/api/upload_path_safety.cy.ts | #1273 | - |
| V1.3.4 | 2 | n/a | SVG is not in the upload allow-list | none | - | - |
| V1.3.5 | 2 | framework | components/legal/LegalDocumentView.tsx renders repository-owned Markdown with react-markdown (no rehype-raw) | lib/legal/content.test.ts (loading only) | - | react-markdown 10.1.0 (package-lock.json) |
| V1.3.6 | 2 | n/a | No server-side fetch of a user-supplied URL; outbound calls use fixed SDK endpoints (see #1241) | none | - | - |
| V1.3.7 | 2 | n/a | Jinja2 runs at generation time on developer-supplied schema only | none | - | - |
| V1.3.8 | 2 | n/a | Not a Java stack | none | - | - |
| V1.3.9 | 2 | n/a | No memcache; Redis calls are parameterized | none | - | - |
| V1.3.10 | 2 | n/a | No format-string interpreter on user input | none | - | - |
| V1.3.11 | 2 | n/a | No SMTP or IMAP transport in the app | none | - | - |
| V1.4.1 | 2 | n/a | Memory-safe runtime (Node.js) | none | - | - |
| V1.4.2 | 2 | framework | Prisma column types and lib/_decimal.ts | none | - | prisma 7.10.1 (package-lock.json); Int is 32-bit, out-of-range values are rejected |
| V1.4.3 | 2 | n/a | Managed-memory runtime (Node.js) | none | - | - |
| V1.5.1 | 1 | n/a | No XML parsing in application code | none | - | - |
| V1.5.2 | 2 | framework | Only JSON.parse of data; no native object deserialization | none | - | Node.js 24.19.0 (version used for this check); JSON.parse returns plain data only |

## V2 Validation and Business Logic

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V2.1.1 | 1 | gap | No validation-rules document | none | #1270 | - |
| V2.1.2 | 2 | gap | validateOnAdd/validateOnUpdate hooks exist; their consistency rules are undocumented | none | #1270 | - |
| V2.1.3 | 2 | gap | Rate limits are documented in docs/knowledge/api-idempotency-and-rate-limiting.md; business limits are not | none | #1270 | - |
| V2.2.1 | 1 | generator | Prisma column types, nativeEnum mapping, read-only field rejection (api_route.ts.jinja2), service_validation hooks; no runtime schema validator | none | #1271 | - |
| V2.2.2 | 1 | generator | service.ts.jinja2 runs validateOn* hooks server-side inside the transaction | none | #1230 | - |
| V2.2.3 | 2 | generator | docs/knowledge/same-entity-validation-socket.md (hand-written per relation, not generic) | none | #1271 | - |
| V2.3.1 | 1 | generator | state_transitions.ts.jinja2 (assertTransitionAllowed); lib/approval_request/order-check.ts | code_generator/tests/test_state_transition_gatekeeper.py, lib/approval_request/actions.test.ts, cypress/e2e/api/multi_stage_approval_order_reached.cy.ts | #1230 | - |
| V2.3.2 | 2 | gap | Rate limits exist; documented business limits do not, so none are enforced | none | #1270 | - |
| V2.3.3 | 2 | generator | Serializable $transaction in service.ts.jinja2 and submit_for_approval.ts.jinja2 | none | #1272, #735 | - |
| V2.3.4 | 2 | generator | x-reservation templates with Serializable isolation | none | #1272 | - |
| V2.4.1 | 2 | generator | lib/rate-limit/{index,redis,in-memory,client-ip}.ts; generated REST routes return 429 | lib/rate-limit/redis.test.ts, in-memory.test.ts, client-ip.test.ts | #1245, #1092, #1125 | - |

## V3 Web Frontend Security

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V3.2.1 | 1 | generator | lib/attachment/storage.ts serveStoredObject (nosniff, no-store, Content-Disposition); attachment_serve_route.ts.jinja2 serves inline only for jpeg, png, gif and webp | cypress/e2e/api/upload_path_safety.cy.ts, lib/attachment/storage.test.ts | - | - |
| V3.2.2 | 1 | framework | React text escaping; no dangerouslySetInnerHTML or innerHTML in app, components or templates | none | #1234 | react 19.3.1 (package-lock.json); JSX escaping docs |
| V3.3.1 | 1 | framework | auth.ts does not override cookie settings; Auth.js sets Secure and the __Secure- prefix on https | none | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); cookies option defaults |
| V3.3.2 | 2 | framework | auth.ts does not override cookie settings; Auth.js default SameSite=Lax | cypress/e2e/api/framework_guarantees.cy.ts (CSRF and session cookie) | - | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); cookies option defaults |
| V3.3.3 | 2 | gap | Session cookie is __Secure-authjs.session-token, not __Host- | none | #1274 | - |
| V3.3.4 | 2 | framework | Auth.js session cookie is HttpOnly; strategy jwt in auth.ts | cypress/e2e/api/framework_guarantees.cy.ts (CSRF and session cookie) | - | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); cookies option defaults |
| V3.4.1 | 1 | generator | lib/security-headers.ts Strict-Transport-Security via next.config.ts headers() | lib/security-headers.test.ts (checks max-age only) | #1123 | - |
| V3.4.2 | 1 | framework | No Access-Control-Allow-Origin is set anywhere; Next.js sends none unless configured | cypress/e2e/api/framework_guarantees.cy.ts (no CORS headers, preflight) | - | next 16.4.2 (package-lock.json); Route Handlers docs |
| V3.4.3 | 2 | gap | CSP carries only frame-ancestors 'none'; no script, style, object or base policy | lib/security-headers.test.ts (asserts the current value) | #1123 | - |
| V3.4.4 | 2 | generator | lib/security-headers.ts X-Content-Type-Options nosniff | lib/security-headers.test.ts | - | - |
| V3.4.5 | 2 | generator | lib/security-headers.ts Referrer-Policy strict-origin-when-cross-origin | lib/security-headers.test.ts | - | - |
| V3.4.6 | 2 | generator | lib/security-headers.ts CSP frame-ancestors 'none' and X-Frame-Options DENY | lib/security-headers.test.ts | - | - |
| V3.5.1 | 1 | gap | Server Actions are checked by Next.js (Origin versus Host; test: cypress/e2e/api/framework_guarantees.cy.ts); generated REST routes do not check Origin or Sec-Fetch-Site | none | #1275 | - |
| V3.5.2 | 1 | gap | Generated write routes parse a text/plain body with request.json(); only the import route enforces application/json | none | #1275 | - |
| V3.5.3 | 1 | generator | Mutating handlers are POST, PUT, PATCH and DELETE; GET handlers only read | none | #1228 | - |
| V3.5.4 | 2 | environment | One generated app per deployment; hostnames are chosen by the deploy scripts (scripts/gcp-deploy.sh, scripts/vercel-setup.sh) | none | - | - |
| V3.5.5 | 2 | n/a | No postMessage usage | none | - | - |
| V3.7.1 | 2 | n/a | No plugin technologies (React, MUI and Next.js only) | none | - | - |
| V3.7.2 | 2 | generator | lib/auth/safe-redirect.ts safeRedirectPath; Stripe checkout redirects use a server-provided URL | lib/auth/safe-redirect.test.ts, app/[locale]/login/page.test.tsx | - | - |

## V4 API and Web Service

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V4.1.1 | 1 | framework | NextResponse.json sets application/json; CSV export sets text/csv; charset=utf-8 | none | #1234 | next 16.4.2 (package-lock.json); Route Handlers docs |
| V4.1.2 | 2 | environment | TLS is terminated by Cloud Run or Vercel; no application redirect code | none | - | - |
| V4.1.3 | 2 | gap | proxy.ts builds redirect URLs from client-sendable x-forwarded-host and x-forwarded-proto without an allow-list | none | #1276 | - |
| V4.2.1 | 2 | environment | Request-smuggling defense belongs to the platform edge and the Next.js server | none | #1244 | - |
| V4.3.1 | 2 | generator | lib/_pagination.ts MAX_PAGE_SIZE=200; sort and filter column allow-lists; import row and byte limits; no GraphQL | none | #1277 | - |
| V4.3.2 | 2 | n/a | No GraphQL endpoint | none | - | - |
| V4.4.1 | 1 | n/a | No WebSocket usage | none | - | - |
| V4.4.2 | 2 | n/a | No WebSocket usage | none | - | - |
| V4.4.3 | 2 | n/a | No WebSocket usage | none | - | - |
| V4.4.4 | 2 | n/a | No WebSocket usage | none | - | - |

## V5 File Handling

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V5.1.1 | 2 | gap | docs/knowledge/upload-format-allowlist-deferral.md lists types and extensions; per-feature size, unpacked size and malicious-file handling are not documented | none | #1279 | - |
| V5.2.1 | 1 | generator | upload_route.ts.jinja2 refuses an upload over UPLOAD_MAX_BYTES (default 10MB) before the body is parsed: a declared Content-Length over the limit is refused unread and a body without one is counted while it streams (lib/_upload_validation.ts readBodyWithLimit); per-user upload rate limit | lib/_upload_validation.test.ts, cypress/e2e/api/upload_path_safety.cy.ts, code_generator/tests/test_upload_route_content_type.py | - | - |
| V5.2.2 | 1 | generator | lib/_upload_validation.ts checks the declared MIME type, the extension and the leading bytes against the format the extension names (images, PDF, Office and archive formats; text formats must hold no NUL byte); an extension added through UPLOAD_ALLOWED_EXTENSIONS that has no signature is accepted on the allow-lists alone; images are not re-encoded | lib/_upload_validation.test.ts, cypress/e2e/api/upload_path_safety.cy.ts, code_generator/tests/test_upload_route_content_type.py | - | - |
| V5.2.3 | 2 | n/a | Uploaded archives are stored and served untouched; the app never decompresses them | none | - | - |
| V5.3.1 | 1 | generator | lib/attachment/storage.ts opaque random key, storage root outside public/ | cypress/e2e/api/upload_path_safety.cy.ts, lib/attachment/storage.test.ts | - | - |
| V5.3.2 | 1 | generator | lib/attachment/upload_core.ts newStorageKey; the original name is stored encrypted for display only | cypress/e2e/api/upload_path_safety.cy.ts, lib/attachment/storage.test.ts | - | - |
| V5.4.1 | 2 | generator | attachment_serve_route.ts.jinja2 contentDisposition(); the name comes from the stored record, not the URL | cypress/e2e/api/upload_path_safety.cy.ts | - | - |
| V5.4.2 | 2 | generator | contentDisposition() sends an ASCII fallback plus filename*=UTF-8'' | none | #1279 | - |
| V5.4.3 | 2 | gap | No antivirus scan or hook | none | #1279 | - |

## V6 Authentication

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V6.1.1 | 1 | generator | docs/knowledge/authentication.md and api-idempotency-and-rate-limiting.md describe the rate limits; lockout and credential stuffing are not discussed | none | #1125 | - |
| V6.1.2 | 2 | gap | No context-specific word list or policy | none | #1280 | - |
| V6.1.3 | 2 | generator | docs/knowledge/authentication.md lists the pathways (credentials, Google, mobile token, API key); required strength per pathway is not stated | code_generator/tests/test_api_route_authentication_enumeration.py (routes call an auth helper) | - | - |
| V6.2.1 | 1 | gap | Registration checks only that a password is present; no minimum length | none | #1125 | - |
| V6.2.2 | 1 | generator | components/setting/password.tsx, lib/setting/password-actions.ts, lib/auth/credential-confirmation.ts | lib/auth/credential-confirmation.test.ts, cypress/e2e/api/setting_credential_confirmation.cy.ts | - | - |
| V6.2.3 | 1 | generator | Current password is verified before a change (lib/setting/password-actions.ts) | lib/auth/credential-confirmation.test.ts, cypress/e2e/api/setting_credential_confirmation.cy.ts | - | - |
| V6.2.4 | 1 | gap | No common-password list | none | #1280 | - |
| V6.2.5 | 1 | generator | No composition rules exist (read in register route and password-actions) | none | #1125 | - |
| V6.2.6 | 1 | generator | type=password on login, register and setting inputs | none | - | - |
| V6.2.7 | 1 | generator | No onPaste handler and no autocomplete=off | none | - | - |
| V6.2.8 | 1 | gap | bcrypt is applied to the raw string and reads only 72 bytes; longer passwords are truncated silently | lib/auth/password-check.test.ts | #1280 | - |
| V6.2.9 | 2 | gap | No maximum or minimum length is enforced | none | #1280, #1125 | - |
| V6.2.10 | 2 | generator | No password expiry or rotation exists | none | - | - |
| V6.2.11 | 2 | gap | No context-word check | none | #1280 | - |
| V6.2.12 | 2 | gap | No breached-password check | none | #1280 | - |
| V6.3.1 | 1 | generator | proxy.ts sign-in bucket (10 per minute per IP); register, mobile-token, MFA and API-key buckets in lib/rate-limit/index.ts | app/api/auth/register/route.test.ts, lib/mfa/verify.test.ts, lib/rate-limit/redis.test.ts, app/api/mobile/auth/token/route.test.ts | #1245, #1125 | - |
| V6.3.2 | 1 | generator | scripts/seed-baseline-credentials.ts requires explicit admin credentials in production; outside production a documented default is seeded | scripts/seed-baseline-credentials.test.ts | - | - |
| V6.3.3 | 2 | gap | MFA is opt-in per user | none | #1281 | - |
| V6.3.4 | 2 | generator | MFA is enforced on credentials, OAuth and the mobile token route; API keys are machine access without MFA by design | cypress/e2e/auth/mfa.cy.ts, cypress/e2e/api/mobile_auth.cy.ts | #1183 | - |
| V6.4.1 | 1 | n/a | The app issues no initial passwords or activation codes | none | - | - |
| V6.4.2 | 1 | generator | No password hints or knowledge-based questions exist | none | - | - |
| V6.4.3 | 2 | gap | No forgot-password flow | none | #1282 | - |
| V6.4.4 | 2 | gap | No MFA factor reset procedure | none | #1282 | - |
| V6.5.1 | 2 | generator | lib/mfa/verify.ts records the last accepted TOTP time step per user (user.mfa_last_totp_step) with a conditional write and refuses a code from that step or an earlier one; a recovery code is stamped used with a conditional write, so it works once | lib/mfa/verify.test.ts, lib/mfa/totp.test.ts | - | - |
| V6.5.2 | 2 | generator | Recovery codes are stored as bcrypt hashes; the TOTP secret is encrypted with AES-256-GCM (lib/mfa/crypto.ts) | lib/mfa/recovery.test.ts, lib/mfa/crypto.test.ts | - | - |
| V6.5.3 | 2 | generator | lib/mfa/recovery.ts uses crypto.randomInt; the otplib random source was not verified | lib/mfa/recovery.test.ts, lib/mfa/totp.test.ts | - | - |
| V6.5.4 | 2 | generator | Recovery codes have 8 characters from 31 symbols; TOTP has 6 digits | lib/mfa/recovery.test.ts | #1292 | - |
| V6.5.5 | 2 | generator | TOTP step tolerance is 30 seconds; recovery codes are single-use | none | - | - |
| V6.6.1 | 2 | n/a | No SMS or PSTN OTP delivery | none | - | - |
| V6.6.2 | 2 | n/a | No out-of-band codes or requests | none | - | - |
| V6.6.3 | 2 | n/a | No out-of-band code mechanism; TOTP and recovery codes are rate limited by auth:mfa:challenge | none | - | - |
| V6.8.1 | 2 | generator | auth.ts signIn callback: verified-email check, domain allow-list, credentials-account collision guard | lib/auth/domain-allow-list.test.ts, cypress/e2e/auth/mfa.cy.ts | #1183 | - |
| V6.8.2 | 2 | framework | Auth.js validates the Google ID token and callback state; the mobile JWT is verified with jose and algorithms HS256 | cypress/e2e/api/mobile_auth.cy.ts (mobile); none for the OAuth signature | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); oauth4webapi 3.8.6, jose 6.2.13 |
| V6.8.3 | 2 | n/a | No SAML | none | - | - |
| V6.8.4 | 2 | n/a | The app never requires a specific authentication strength or recentness from the identity provider | none | - | - |

## V7 Session Management

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V7.1.1 | 2 | gap | No session maxAge or updateAge is set; docs cite a JWT_MAX_AGE variable that no code reads | none | #1284 | - |
| V7.1.2 | 2 | gap | No concurrent-session policy | none | #1284, #1127 | - |
| V7.1.3 | 2 | n/a | The app is the only session creator; no federated session coordination | none | - | - |
| V7.2.1 | 1 | generator | proxy.ts and auth.ts verify sessions server-side; lib/api-auth.ts for mobile JWT and API key | code_generator/tests/test_api_route_authentication_enumeration.py, auth.jwt-erased.test.ts, lib/api-auth.test.ts | - | - |
| V7.2.2 | 1 | generator | Auth.js JWT for the web, lib/mobile-auth.ts signed access tokens (15 minutes); API keys are machine auth, stored only as a SHA-256 hash and shown once when issued (docs/knowledge/api-key-hashing.md) | cypress/e2e/api/mobile_auth.cy.ts, cypress/e2e/api/api_key_storage.cy.ts, lib/api-key.test.ts, lib/api-auth.test.ts | #1124 | - |
| V7.2.3 | 1 | generator | lib/mobile-auth.ts refresh token is randomBytes(32) stored as HMAC-SHA256; web sessions are self-contained JWTs | cypress/e2e/api/mobile_auth.cy.ts | - | - |
| V7.2.4 | 1 | gap | A new web JWT is minted at sign-in but the old one stays valid (stateless); mobile refresh rotation is covered | cypress/e2e/api/mobile_auth.cy.ts (rotation) | #1127 | - |
| V7.3.1 | 2 | gap | No web inactivity timeout | none | #1284 | - |
| V7.3.2 | 2 | gap | No configured absolute web lifetime | none | #1284 | - |
| V7.4.1 | 1 | gap | Web sign-out clears the cookie but the JWT stays valid; mobile logout revokes the session | cypress/e2e/api/mobile_auth.cy.ts (mobile revoke) | #1127 | - |
| V7.4.2 | 1 | gap | Only erasure ends sessions (lib/compliance/anonymize_user.ts); no user disable state | lib/compliance/anonymize_user.test.ts, auth.jwt-erased.test.ts | #1127 | - |
| V7.4.3 | 2 | gap | Password change and MFA changes do not revoke other sessions | none | #1127 | - |
| V7.4.4 | 2 | generator | signOut() is reachable from the header and sidebar slots on every authenticated page | none | - | - |
| V7.4.5 | 2 | gap | No administrator session termination for web users | none | #1127 | - |
| V7.5.1 | 2 | gap | Password change and MFA disable require the current credential; email change does not | lib/auth/credential-confirmation.test.ts | #1285 | - |
| V7.5.2 | 2 | gap | Only mobile sessions are listable and revocable, by their owner | cypress/e2e/api/mobile_auth.cy.ts | #1127 | - |
| V7.6.1 | 2 | gap | Identity-provider and relying-party session behavior is not documented | none | #1284 | - |
| V7.6.2 | 2 | generator | Sessions are created only by an explicit login submit, OAuth button or mobile token request | cypress/e2e/auth.cy.ts, cypress/e2e/api/mobile_auth.cy.ts | - | - |

## V8 Authorization

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V8.1.1 | 1 | generator | docs/knowledge/authorization-default-deny.md and multi-tenancy-and-permissions.md | none | - | - |
| V8.1.2 | 2 | gap | Partial notes only (x-write-locked-values, x-pii, write-only fields); no single rule document | none | #1286 | - |
| V8.1.3 | 3 | gap | No document states which contextual attributes drive decisions (the only IP use is rate-limit keying) | none | #1286 | - |
| V8.1.4 | 3 | gap | No document on contextual factors in authentication and authorization decisions | none | #1286 | - |
| V8.2.1 | 1 | generator | lib/authz.ts requireEntityPermission (default deny), lib/api-auth.ts requireApiPermission, actions.ts.jinja2 | code_generator/tests/test_api_route_authentication_enumeration.py, test_authz_call_site_enumeration.py, security matrix permission_denied cell (check:security-matrix) | - | - |
| V8.2.2 | 1 | generator | lib/authz.ts record scope (Creator, Assignee) and organization row filtering | lib/authz_record_scope.test.ts, security matrix cross_org cell, code_generator/tests/test_bulk_route_self_only_richperms.py | #1121, #1257 | - |
| V8.2.3 | 2 | gap | Write-only fields are stripped from reads and x-write-locked-values locks values after approval; no per-role field permission model | code_generator/tests/test_rest_update_write_only_omitted_unchanged.py, cypress/e2e/api/setting_write_only_omitted.cy.ts | #1287, #1230, #1235 | - |
| V8.2.4 | 3 | gap | No IP, device, time or location based control (Level 3) | none | #1288 | - |
| V8.3.1 | 1 | generator | Enforcement is in route handlers, actions and the service layer; client permission flags are display only | code_generator/tests/test_api_route_authentication_enumeration.py, security matrix permission_denied cell | - | - |
| V8.3.2 | 3 | gap | Permission cache invalidation is not propagated or called from mutation paths; web sessions cannot be revoked | none | #1224, #731, #1127 | - |
| V8.3.3 | 3 | generator | lib/api-auth.ts withActor and lib/_request_scope.ts resolve permissions for the originating user | lib/api-auth.test.ts, cypress/e2e/api/mobile_auth.cy.ts | #1124 | - |
| V8.4.1 | 2 | generator | Organization is the enforced isolation boundary; the cross_org matrix cell requires organization filtering | security matrix cross_org cell (check:security-matrix) | #1193 | - |
| V8.4.2 | 3 | gap | No step-up or contextual check on administrative interfaces (Level 3) | none | #1288 | - |

## V9 Self-contained Tokens

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V9.1.1 | 1 | generator | lib/mobile-auth.ts uses jose jwtVerify; the web JWT is verified by Auth.js | lib/mobile-auth.test.ts, cypress/e2e/api/mobile_auth.cy.ts (no tampered-token case) | - | - |
| V9.1.2 | 1 | generator | jwtVerify(..., { algorithms: ['HS256'] }) in lib/mobile-auth.ts | cypress/e2e/api/mobile_auth.cy.ts (a no-type-claim HS256 token is rejected) | - | - |
| V9.1.3 | 1 | generator | The key is the fixed AUTH_SECRET; no jku, jwk or kid lookup exists | none | - | - |
| V9.2.1 | 1 | generator | jose enforces exp; mobile access tokens expire after 15 minutes | none | - | - |
| V9.2.2 | 2 | generator | verifyMobileAccessToken rejects payload.type other than mobile_access | cypress/e2e/api/mobile_auth.cy.ts (token without type) | - | - |
| V9.2.3 | 2 | gap | Mobile access tokens carry no aud or iss claim | none | #1289 | - |
| V9.2.4 | 2 | gap | One key signs web and mobile tokens, separated only by the type claim | none | #1289 | - |

## V10 OAuth and OIDC

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V10.1.1 | 2 | framework | Auth.js session token is an HttpOnly cookie; the server performs the OAuth exchange | none | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json) |
| V10.1.2 | 2 | framework | Auth.js Google provider checks state, PKCE and nonce; the e2e mock provider bypasses the handshake | none (the mock provider cannot exercise it) | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); oauth4webapi 3.8.6 |
| V10.2.1 | 2 | framework | Auth.js uses PKCE and state by default; auth.ts overrides only prompt | none | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json) |
| V10.2.2 | 2 | n/a | Only one authorization server (Google) | none | - | - |
| V10.3.1 | 2 | n/a | The app is not a resource server for third-party OAuth tokens | none | - | - |
| V10.3.2 | 2 | n/a | The app is not a resource server for third-party OAuth tokens | none | - | - |
| V10.3.3 | 2 | n/a | The app is not a resource server for third-party OAuth tokens | none | - | - |
| V10.3.4 | 2 | n/a | The app is not a resource server for third-party OAuth tokens | none | - | - |
| V10.4.1 | 1 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.2 | 1 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.3 | 1 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.4 | 1 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.5 | 1 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.6 | 2 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.7 | 2 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.8 | 2 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.9 | 2 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.10 | 2 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.4.11 | 2 | n/a | The app is not an OAuth authorization server | none | - | - |
| V10.5.1 | 2 | framework | Auth.js checks the ID token nonce, state and PKCE | none | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); oauth4webapi 3.8.6 |
| V10.5.2 | 2 | gap | allowDangerousEmailAccountLinking is true, so users are matched by email | none | #1183 | - |
| V10.5.3 | 2 | framework | Auth.js validates the ID token issuer for the fixed Google provider | none | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); oauth4webapi 3.8.6 |
| V10.5.4 | 2 | framework | Auth.js validates the ID token audience against GOOGLE_CLIENT_ID | none | #1234 | next-auth 5.0.0-beta.32, @auth/core 0.41.3 (package-lock.json); oauth4webapi 3.8.6 |
| V10.5.5 | 2 | n/a | OIDC back-channel logout is not used | none | - | - |
| V10.6.1 | 2 | n/a | The app is a relying party, not an OpenID Provider | none | - | - |
| V10.6.2 | 2 | n/a | The app is a relying party, not an OpenID Provider | none | - | - |
| V10.7.1 | 2 | n/a | The app presents no consent screen for third-party clients | none | - | - |
| V10.7.2 | 2 | n/a | The app presents no consent screen for third-party clients | none | - | - |
| V10.7.3 | 2 | n/a | The app presents no consent screen for third-party clients | none | - | - |

## V11 Cryptography

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V11.1.1 | 2 | gap | AUTH_SECRET derives the MFA, attachment-name, import-token and refresh-token keys; no key lifecycle document | none | #1290 | - |
| V11.1.2 | 2 | gap | No cryptographic inventory | none | #1290 | - |
| V11.2.1 | 2 | generator | node:crypto and bcryptjs in lib/mfa, lib/auth; session crypto from Auth.js; no hand-rolled primitives found | lib/mfa/crypto.test.ts, lib/auth/password-check.test.ts | - | - |
| V11.2.2 | 2 | gap | Algorithms and the bcrypt cost are hard-coded; the encryption format has a v1 prefix but no key id | lib/mfa/crypto.test.ts (format prefix) | #1291 | - |
| V11.2.3 | 2 | generator | AES-256-GCM, HMAC-SHA256, SHA-256, bcrypt; the strength of AUTH_SECRET itself is not enforced | lib/mfa/crypto.test.ts | - | - |
| V11.3.1 | 1 | generator | No ECB, PKCS#1 v1.5 or createCipher use found; only aes-256-gcm | none | - | - |
| V11.3.2 | 1 | generator | aes-256-gcm with a 12-byte random nonce (lib/mfa/crypto.ts, lib/compliance/attachment_name_crypto.ts) | lib/mfa/crypto.test.ts (fresh ciphertext per call) | - | - |
| V11.3.3 | 2 | generator | GCM auth tag verified in decryptSecret; import token verified in lib/_import.ts | lib/mfa/crypto.test.ts (tampered ciphertext rejected) | - | - |
| V11.4.1 | 1 | generator | SHA-256 and HMAC-SHA256 only; no md5 or sha1 in lib, app or templates | none | - | - |
| V11.4.2 | 2 | generator | bcryptjs for passwords at cost 10 | lib/auth/password-check.test.ts, lib/auth/credential-confirmation.test.ts | #1291 | - |
| V11.4.3 | 2 | generator | SHA-256 audit-log digest and HMAC-SHA256 tokens | lib/audit-log-integrity/digest.test.ts | - | - |
| V11.4.4 | 2 | n/a | No password-derived keys; the MFA key is derived from the server secret | none | - | - |
| V11.5.1 | 2 | gap | Recovery codes carry about 40 bits; other tokens use randomBytes(32) or randomUUID() | lib/mfa/recovery.test.ts (no modulo bias) | #1292 | - |
| V11.6.1 | 2 | n/a | No asymmetric key generation or digital signatures | none | - | - |

## V12 Secure Communication

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V12.1.1 | 1 | environment | TLS is terminated by Cloud Run or Vercel; the Dockerfile serves plain HTTP behind it | none | - | - |
| V12.1.2 | 2 | environment | Cipher suites are chosen by the platform | none | - | - |
| V12.1.3 | 2 | n/a | No client-certificate authentication | none | - | - |
| V12.2.1 | 1 | generator | HSTS via lib/security-headers.ts; the mobile base URL is not forced to https | lib/security-headers.test.ts | #1293 | - |
| V12.2.2 | 1 | environment | Managed certificates from Cloud Run or Vercel | none | - | - |
| V12.3.1 | 2 | generator | lib/db-url.ts pins verify-full for Postgres; the Upstash database is created with TLS; production does not fail on an unprotected URL | lib/db-url.test.ts | #1293 | - |
| V12.3.2 | 2 | generator | lib/db-url.ts verify-full; nothing sets NODE_TLS_REJECT_UNAUTHORIZED or rejectUnauthorized false | lib/db-url.test.ts | - | - |
| V12.3.3 | 2 | environment | Single service; no internal HTTP between services | none | - | - |
| V12.3.4 | 2 | n/a | No internal services with internal CAs | none | - | - |

## V13 Configuration

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V13.1.1 | 2 | gap | No list of external services in one place | none | #1294, #1241 | - |
| V13.2.1 | 2 | gap | Backend dependencies use static credentials (database password, Redis URL, CRON_SECRET); audit-log GCS can use workload identity | lib/audit-log-integrity/storage-gcs.test.ts | #1295, #1124, #1143 | - |
| V13.2.2 | 2 | generator | Restricted database role on Vercel; narrow GCS bucket role; GCP database role was not verified | scripts/vercel-env.test.ts, scripts/gcp-storage-config.test.ts | - | - |
| V13.2.3 | 2 | generator | Production seeding requires explicit admin credentials; docker-compose.prod.yml requires POSTGRES_PASSWORD from the environment and has no default | scripts/seed-baseline-credentials.test.ts, scripts/docker-compose-prod-password.test.ts | - | - |
| V13.2.4 | 2 | gap | No outbound allow-list; server fetch targets fixed SDK endpoints only | none | #1294 | - |
| V13.2.5 | 2 | environment | Egress restriction is a platform setting and is not configured by the deploy scripts | none | #1294 | - |
| V13.3.1 | 2 | generator | Secrets go to Secret Manager (scripts/gcp-setup.sh) or sensitive Vercel variables (scripts/vercel-env.sh) | scripts/vercel-env.test.ts, scripts/env-file-permissions.test.ts | #1248 | - |
| V13.3.2 | 2 | generator | Least-privilege roles for GCS and Vercel previews; per-secret scope of the GCP accessor binding was not verified | scripts/gcp-storage-config.test.ts, scripts/vercel-env.test.ts | - | - |
| V13.4.1 | 1 | environment | The runner image copies only build output; there is no .dockerignore for the build context | none | #1297 | - |
| V13.4.2 | 2 | generator | Swagger UI gated on SWAGGER_UI_ENABLED; reset-caches route returns 404 without TEST_RESET_TOKEN; poweredByHeader false | none (no direct test of the production-off behavior) | - | - |
| V13.4.3 | 2 | framework | Next.js serves no directory listing; only files under public/ by exact path | none | #1234 | next 16.4.2 (package-lock.json); public folder docs |
| V13.4.4 | 2 | environment | Next.js route handlers answer only their exported methods; the platform front end filters TRACE | none | #1234 | - |
| V13.4.5 | 2 | gap | The OpenAPI document is served to any authenticated user; the Dockerfile HEALTHCHECK calls /api/health, which no route serves | none | #1161, #1297 | - |

## V14 Data Protection

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V14.1.1 | 2 | gap | Only user columns are classified (x-pii); x-pii is not consulted for logs, exports, REST or OpenAPI | none | #1298 | - |
| V14.1.2 | 2 | gap | No protection requirements per classification level | none | #1298 | - |
| V14.2.1 | 1 | generator | API keys and tokens are read from headers; credentials are posted in bodies; GCS URLs carry no filename | cypress/e2e/api/upload_path_safety.cy.ts, lib/api-auth.test.ts | - | - |
| V14.2.2 | 2 | gap | idempotency_key.response_body persists responses without a purge; attachment responses are no-store | lib/attachment/storage.test.ts | #1299 | - |
| V14.2.3 | 2 | generator | No analytics, tracker or third-party script | none | - | - |
| V14.2.4 | 2 | gap | Controls exist piecemeal; no documented protection requirements to trace them to | lib/prisma-slow-query.test.ts (parameter redaction) | #1298 | - |
| V14.3.1 | 1 | gap | No Clear-Site-Data on sign-out | none | #1300 | - |
| V14.3.2 | 2 | gap | Only the attachment route sets Cache-Control | lib/attachment/storage.test.ts | #1300 | - |
| V14.3.3 | 2 | gap | Mobile web build keeps the refresh token in localStorage; native uses SecureStore | none | #1301 | - |

## V15 Secure Coding and Architecture

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V15.1.1 | 1 | gap | CI audit job gates high and critical advisories; no remediation time frames | none | #1302 | - |
| V15.1.2 | 2 | gap | package-lock.json and npm ci; no SBOM or trusted-source policy | none | #1302 | - |
| V15.1.3 | 2 | gap | Limits are scattered across documents | none | #1302 | - |
| V15.2.1 | 1 | generator | CI audit job (npm audit, pip-audit) blocks on high and critical | CI job audit (.github/workflows/ci.yml); gate steps 19 and 20 | #1074 | - |
| V15.2.2 | 2 | generator | Rate-limit buckets, MAX_PAGE_SIZE, import limits, upload quota | lib/rate-limit/redis.test.ts, lib/rate-limit/in-memory.test.ts, lib/_pagination.test.ts | #1245 | - |
| V15.2.3 | 2 | generator | reset-caches route is token-gated; mock OAuth is gated by a filesystem sentinel | lib/auth/mock-oauth-gate.test.ts, lib/_secret_compare.test.ts | - | - |
| V15.3.1 | 1 | generator | Write-only fields are removed from reads (getters_internal.ts.jinja2); other fields are returned in full | code_generator/tests/test_rest_update_write_only_omitted_unchanged.py, cypress/e2e/api/setting_write_only_omitted.cy.ts | #1235 | - |
| V15.3.2 | 2 | n/a | No server-side fetch of a user-controlled URL | none | - | - |
| V15.3.3 | 2 | generator | api_route.ts.jinja2 destructures only the allowed create fields and rejects read-only fields | code_generator/tests/test_bulk_route_readonly_fields.py, test_readonly_fields.py, test_org_readonly_field_write_guard.py, test_write_locked_values.py | - | - |
| V15.3.4 | 2 | generator | lib/rate-limit/client-ip.ts takes the entry TRUSTED_PROXY_HOPS from the right of X-Forwarded-For | lib/rate-limit/client-ip.test.ts | #1245 | - |
| V15.3.5 | 2 | gap | Request bodies are untyped (request.json()); no strict-equality lint rule | none | #1271, #1303 | - |
| V15.3.6 | 2 | gap | No prototype-pollution policy or lint rule; bodies are destructured into explicit fields | none | #1303 | - |
| V15.3.7 | 2 | framework | Query parameters are read first-value-only and the body separately; the two are never merged | none | #1234 | next 16.4.2 (package-lock.json); Route Handlers docs |

## V16 Security Logging and Error Handling

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V16.1.1 | 2 | gap | Only audit_log is documented | none | #1305 | - |
| V16.2.1 | 2 | gap | audit_log has no source IP, user agent or request id | lib/audit-log.test.ts | #1306 | - |
| V16.2.2 | 2 | generator | audit_log.created_at is Timestamptz and written in UTC | lib/audit-log.test.ts, lib/audit-log-integrity/digest.test.ts | - | - |
| V16.2.3 | 2 | gap | No inventory of permitted log sinks | none | #1305 | - |
| V16.2.4 | 2 | gap | Console output formats are mixed | none | #1237 | - |
| V16.2.5 | 2 | generator | Emails are kept out of audit_log metadata and auth logs; slow-query parameters are redacted | lib/auth/audit-no-pii.test.ts, lib/prisma-slow-query.test.ts | #1237 | - |
| V16.3.1 | 2 | gap | Sign-in, sign-out, rejects and MFA events are audited; failed credentials, invalid API keys and failed mobile tokens are not | cypress/e2e/audit_log.cy.ts (sign-in only) | #1307 | - |
| V16.3.2 | 2 | gap | Authorization denials are not logged | none | #1307 | - |
| V16.3.3 | 2 | gap | No security-event list; rate-limit hits and control bypass attempts are not logged | none | #1307 | - |
| V16.3.4 | 2 | generator | handleApiError logs unexpected errors; Redis rate-limit failures and startup failures are logged | lib/api-auth.test.ts, lib/rate-limit/redis.test.ts | - | - |
| V16.4.1 | 2 | gap | Only some log lines are JSON-encoded; others pass raw values | none | #1237 | - |
| V16.4.2 | 2 | generator | audit_log is append-only (Prisma guard, database trigger, restricted role, digest chain) | lib/audit-log-integrity/guard.test.ts, digest.test.ts, code_generator/tests/test_audit_log_append_only_templates.py | #990, #1193 | - |
| V16.4.3 | 2 | environment | Audit digests are stored outside the database (S3 Object Lock, GCS); stdout log forwarding is a platform setting | lib/audit-log-integrity/storage-gcs.test.ts | #991 | - |
| V16.5.1 | 2 | generator | handleApiError returns a generic body for unknown errors; some ApiError(403) paths still pass an exception message | lib/api-auth.test.ts, code_generator/tests/test_error_text_not_forwarded.py | #1095 | - |
| V16.5.2 | 2 | generator | Rate limiter falls back to in-memory when Redis fails; no circuit breaker for the database, Stripe or storage | lib/rate-limit/redis.test.ts | - | - |
| V16.5.3 | 2 | generator | Default-deny authorization and a 500 fallback in each route wrapper | lib/authz.test.ts, code_generator/tests/test_api_route_authentication_enumeration.py | - | - |
| V16.5.4 | 3 | framework | Next.js catches unhandled route and render errors and returns a 500; app/[locale]/error.tsx exists | none | #1304, #1234 | next 16.4.2 (package-lock.json); error handling docs |

## V17 WebRTC

| ID | Level | Status | Covered by | Verified by | Gap Issue | Source and version |
|----|-------|--------|------------|-------------|-----------|--------------------|
| V17.1.1 | 2 | n/a | The app has no real-time media or WebRTC | none | - | - |
| V17.2.1 | 2 | n/a | The app has no real-time media or WebRTC | none | - | - |
| V17.2.2 | 2 | n/a | The app has no real-time media or WebRTC | none | - | - |
| V17.2.3 | 2 | n/a | The app has no real-time media or WebRTC | none | - | - |
| V17.2.4 | 2 | n/a | The app has no real-time media or WebRTC | none | - | - |
| V17.3.1 | 2 | n/a | The app has no real-time media or WebRTC | none | - | - |
| V17.3.2 | 2 | n/a | The app has no real-time media or WebRTC | none | - | - |
