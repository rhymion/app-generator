# Field-level authorization rules and contextual attributes

This document is the single place that states which rules decide whether a caller may read or write a field of a record, and which environmental or contextual attributes (IP address, device, time) the app uses in security decisions. It describes the code as it is today. Coverage rows: V8.1.2, V8.1.3 and V8.1.4 in [security-asvs-coverage.md](security-asvs-coverage.md). Operation-level rules (who may create, read, update or delete a record of an entity) are in [authorization-default-deny.md](authorization-default-deny.md).

## Order of decisions

1. **Operation permission.** The caller's role grants `create`, `read`, `update` or `delete` on the entity, or the request is refused (default deny). The REST routes call `requireApiPermission`; the Server Actions use the same permission lookup.
2. **Record scope.** Organization isolation and item-level roles (`Creator`, `Assignee`) narrow which records the caller reaches.
3. **Field rules,** below, applied to the fields of a record the caller may already reach. A field rule never widens access; it can only withhold a field from a read or refuse a value on a write.

## Field rules

| Rule | Declared by | Read side | Write side |
|------|-------------|-----------|------------|
| Write-only | A string field whose `x-custom-component.target` contains `upsert` but not `view` (for example `password`, `api_key`) | Never returned: not in view pages, API detail, list, export or search responses. The OpenAPI document marks it `writeOnly`. | Accepted on create and update |
| Readonly | `x-readonly` on a property (every view of the model) or `x-readonly-fields` on a view entity (that view only) | Returned and shown normally; the OpenAPI record schema marks it `readOnly` | The form shows it uneditable. REST create rejects any submitted value (`400`, `Field <name> is read-only and cannot be set`); REST update and bulk update reject a changed value (`400`, `... cannot be changed`). A field with `x-server-value` is filled by the server instead of being rejected. |
| Write-locked values | `x-write-locked-values`, plus the `set_fields` values of an `x-approval` block | Value is visible | A locked value cannot be set through any plain create or update (form, Server Action, REST, CSV import). Resubmitting the value a record already holds is allowed. See [x-write-locked-values-field-lockdown.md](x-write-locked-values-field-lockdown.md). |
| State-dependent | A declared state machine, or `x-approval` | Value is visible | An update may only follow a declared transition, a create may only start in a declared initial state, and once an approvable record reaches a terminal state its edit, delete and invalidate operations are locked. |
| Personal data | `x-pii` | Value is visible to permitted callers | Erasure scrubs every `x-pii` field. See [x-pii.md](x-pii.md). |

Row-level legality can be read before acting: `GET /api/{entity}/[id]/capabilities` reports which operations, writes and transitions are allowed for that record now, using the same checks as the write path.

### Known limitations

- The readonly annotations do not reach the inline editing of a DataGrid child: a field declared readonly on the child still renders as an editable cell, and the child's create and update calls accept client values for it. Treat child fields as unprotected by `x-readonly`; see [readonly-field-form-rendering.md](readonly-field-form-rendering.md).
- Schema keywords such as `maxLength` and `minimum` are form-only; see [input-validation-rules-and-limits.md](input-validation-rules-and-limits.md).

## Contextual attributes in security decisions

| Attribute | Used for | Not used for |
|-----------|----------|--------------|
| Client IP address | Rate-limit keys for unauthenticated routes and for the sign-in, registration and mobile-token buckets. It is read from `X-Forwarded-For` by counting `TRUSTED_PROXY_HOPS` entries from the right (default 1), falling back to `X-Real-IP`, then `unknown` (`lib/rate-limit/client-ip.ts`). | Allowing or denying access to data. No IP allow-list, deny-list or geolocation rule exists. |
| Credential type | Choosing the authentication path: session cookie, mobile bearer token (the `type: mobile_access` claim) or API key. | Narrowing permissions: an API key and a session for the same user have the same role permissions. |
| Time | Lifetime of credentials and tokens (sessions, the 15-minute mobile access token, the 30-day refresh token, the 5-minute import token, API key expiry) and rate-limit windows. | Time-of-day or day-of-week access rules. None exist. |
| Device or user agent | Nothing in a decision. The app does not read the `User-Agent` header. A mobile sign-in stores a client-supplied `device_name` so the user can recognize and revoke their own sessions; it is a label, not an input to any access decision. | Access control, step-up authentication or risk scoring. |
| Authentication strength | Whether MFA is enrolled and verified at sign-in; over REST, changing the password or the email requires the current password, and turning MFA off requires a current MFA code (see [authentication.md](authentication.md), which also states which settings-page paths are not covered yet). | Per-record or per-field step-up: a signed-in caller's access does not depend on how recently they authenticated. |

A deployment that needs a contextual rule (office-network-only access, a device check, working hours) adds it in front of the app (the platform's firewall or identity-aware proxy) or in the hand-written validation of the entity; the generated app has no schema key for it.
