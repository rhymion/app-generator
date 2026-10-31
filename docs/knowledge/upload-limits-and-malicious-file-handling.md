# Upload limits and malicious-file handling

This document states the size limits that apply to uploaded files, what the app does and does not do with archive contents, and who is responsible for scanning files for malware. It describes the code as it is today. The accepted file types and the content-signature check are in [upload-format-allowlist-deferral.md](upload-format-allowlist-deferral.md); this document does not repeat them. Coverage rows: V5.1.1, V5.4.2 and V5.4.3 in [security-asvs-coverage.md](security-asvs-coverage.md).

## Size limits

| Limit | Value | Configuration | Behavior |
|-------|-------|---------------|----------|
| File size | 10 MiB | `UPLOAD_MAX_BYTES` (a non-positive or non-numeric value falls back to the default) | Applied before the body is parsed. A declared `Content-Length` over the limit plus 64 KiB of multipart framing is refused unread; a body with no or a false `Content-Length` is counted while it streams and abandoned at the limit. The answer is `413`. |
| Upload rate | 30 uploads per user per 10 minutes | `RATE_LIMIT_UPLOAD_LIMIT` | `429` with `Retry-After`. See [api-idempotency-and-rate-limiting.md](api-idempotency-and-rate-limiting.md). |
| Attachments per request | 100 | none | Applies to the request that links already-uploaded files to a record. |

The size limit is one value for the whole app. There is no per-feature, per-entity, per-field or per-user size limit and no storage quota. A deployment that needs a smaller limit for one feature enforces it in that entity's hand-written validation (see [input-validation-rules-and-limits.md](input-validation-rules-and-limits.md)).

## Archives and unpacked size

`zip`, `docx` and `xlsx` are on the default allow-list. The app checks only the leading bytes of such a file (the ZIP header). It never opens, lists or unpacks an archive, so it has no unpacked-size, entry-count or nesting policy: the 10 MiB limit applies to the compressed upload, and the file is stored and served unchanged.

Anything that unpacks or parses an uploaded archive or Office file (a consumer's own import job, a preview or conversion service) must apply its own limit on unpacked size, entry count and path names before extracting. A deployment that does not need archives removes `zip`, `docx` and `xlsx` from `UPLOAD_ALLOWED_EXTENSIONS` and the matching types from `UPLOAD_ALLOWED_MIME_TYPES`.

## What the app does with a hostile file

| Protection | Behavior |
|------------|----------|
| Type | Extension and declared type must both be allow-listed, and the leading bytes must match the format. SVG and HTML are not allowed. The stored type is derived from the extension, not taken from the request. |
| Storage name | The stored object has a generated key. The original file name is stored encrypted and is not used as a path ([cryptographic-inventory-and-key-management.md](cryptographic-inventory-and-key-management.md)). |
| Download | Served only through the authenticated attachment route, after a read-permission check; a file the caller may not read answers `404`. Every response carries `X-Content-Type-Options: nosniff`. Only JPEG, PNG, GIF and WebP are served `inline`; every other type is served as an `attachment`, so the browser downloads it instead of rendering it. |
| Content | **Not scanned.** The app has no antivirus integration and no scan hook. A file that passes the checks above is stored and served as is. |

## Malware scanning is the deployer's responsibility

A deployment that accepts files from users who are not fully trusted must scan them outside the app. Two places work with the current code:

- at the storage layer, using the storage provider's malware scanning or an object-created trigger that scans a new object and quarantines or deletes it;
- at the consumer's own download or processing path, before a file is opened by anything other than a browser download.

The app does not wait for a scan result: a file is available to anyone allowed to read it as soon as it is stored. Closing that window in the app would need a scan status on the attachment and a hook in the upload route; neither exists, and this document makes no claim about them.

## Download file names

The download response sets `Content-Disposition` to the disposition (`inline` or `attachment`), an ASCII `filename` and an RFC 5987 `filename*=UTF-8''` value:

- in the ASCII `filename`, every character outside printable ASCII (`0x20`–`0x7e`), every double quote and every backslash is replaced with `_`, so a quote, a CR or LF, or a non-ASCII character in a name cannot end the quoted string or add a header;
- `filename*` is the name passed through `encodeURIComponent`, which percent-encodes quotes, spaces, CR, LF and non-ASCII characters.

The function is defined inside the generated route (`attachment_serve_route.ts.jinja2`), not in a shared module, and no unit test covers its output yet.
