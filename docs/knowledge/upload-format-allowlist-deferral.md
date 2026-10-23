# Upload Format Allow-list Tightening: Deferred (2026-09-02)

## Current state (as implemented today)

Both upload routes already validate file type against an allow-list
before accepting a file:

- `code_generator/templates/upload_route_vercel.ts.jinja2` (`validTypes`,
  lines 22-36)
- `code_generator/templates/upload_route_gcs.ts.jinja2` (`validTypes`,
  lines 22-35)

The two templates carry an identical, 13-entry list:

```
image/jpeg, image/jpg, image/png, image/gif, image/webp,
application/pdf,
application/msword,
application/vnd.openxmlformats-officedocument.wordprocessingml.document,
application/vnd.ms-excel,
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
text/csv, text/plain,
application/zip
```

`image/svg+xml` is **not** in this list, so SVG upload is already
rejected -- the script-execution hole an SVG allow would open is
already closed.

The check is a straight `!validTypes.includes(file.type)` against the
browser-supplied `File.type` (MIME), performed immediately after
`formData.get('file')`, before any I/O. There is no check against the
file's extension. Since `file.type` is client-supplied, a caller hitting
the API route directly can set any `Content-Type` it likes and pass this
check alone -- e.g. send an `audio/mpeg` file labeled `image/png`.

A second check closes that gap for content: both routes then call
`uploadContentMatchesDeclaredType` (`lib/upload-content-check.ts`), which
compares the first 8 KiB of the file with the signature the declared type
implies and answers `400` on a mismatch. Images, PDF, legacy Office
(`application/msword`) and ZIP-based formats (`.docx`, `.xlsx`, `.zip`)
must start with their magic bytes; `text/plain` and `text/csv` must contain
no NUL byte and must not start with an HTML, SVG or script tag;
`application/vnd.ms-excel` accepts either the legacy signature or text,
because common clients label plain `.csv` files with that type. It needs no
dependency and does not open archives.

## Decision: deferred, not unimplemented

**Product decision (2026-09-02): tightening the allow-list further is
deferred.** The declared-type content check above is the only content
inspection; a file-signature library is not used.

This is a deliberate deferral of a design that already exists, not a
gap that hasn't been looked at yet. The allow-list and the MIME-only
check described above are the shipped, working behavior; narrowing
the list further and/or adding content-sniffing were evaluated and
put off, not left undone by oversight.

Rationale for the deferral: narrowing to "images + PDF only" would
also block legitimate business documents (`.doc`/`.docx`/`.xls`/
`.xlsx`), which may still be wanted for attachments. The
declared-type content check covers the main abuse vector (direct API calls
with a spoofed `Content-Type`) without a file-signature library.

## If this is revisited

A fuller design was already worked out and does not need to be
redone from scratch if stricter validation is wanted later. The
shape of it:

- an environment-variable-configurable MIME allow-list AND a
  separate environment-variable-configurable extension allow-list,
  checked together (both must match, not just one) -- following the
  same env-var pattern already used elsewhere in this codebase for
  import size/row limits
- a recommended default of images + PDF only for a locked-down
  deployment
- a matching gap on the CSV import route: no server-side check today
  that request body content sent as CSV under an `application/json`
  wrapper is actually well-formed CSV text; a `Content-Type` header
  check plus a null-byte check (no magic-byte parsing) was the
  proposed fix there too

None of this is implemented; it is a design to reuse later, not a
description of current code.
