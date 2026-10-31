# Upload Format Allow-list

## Behavior

`POST /api/upload` (generated from `code_generator/templates/upload_route.ts.jinja2`; one route
serves every storage backend) validates every file through
`lib/_upload_validation.ts` before any I/O:

- the declared multipart `Content-Type` must be on the MIME allow-list, AND
- the file name's extension must be on the extension allow-list.

Both must match; either one failing returns `400 Invalid file type.` A file with no
extension is rejected.

The Content-Type stored with the object (and therefore served for it) is derived from the
extension, not copied from the request. For example `image/jpg` is stored as `image/jpeg`
and a `.csv` declared as `application/vnd.ms-excel` is stored as `text/csv`.

## Configuration

| Variable | Meaning | Default |
|---|---|---|
| `UPLOAD_ALLOWED_MIME_TYPES` | Comma-separated MIME allow-list | the 13 types below |
| `UPLOAD_ALLOWED_EXTENSIONS` | Comma-separated extension allow-list (leading dot optional) | the 13 extensions below |

Unset or blank falls back to the default. The default keeps common business documents
working:

```
MIME:       image/jpeg, image/jpg, image/png, image/gif, image/webp, application/pdf,
            application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document,
            application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
            text/csv, text/plain, application/zip
Extensions: jpg, jpeg, png, gif, webp, pdf, doc, docx, xls, xlsx, csv, txt, zip
```

`image/svg+xml` and HTML are not on either list. A locked-down deployment narrows both
lists to images and PDF, for example
`UPLOAD_ALLOWED_MIME_TYPES=image/jpeg,image/png,image/gif,image/webp,application/pdf` and
`UPLOAD_ALLOWED_EXTENSIONS=jpg,jpeg,png,gif,webp,pdf`. An extension added to the extension
list that has no entry in `UPLOAD_CONTENT_TYPE_BY_EXTENSION` is stored with its declared
(allow-listed) MIME type.

## Limits

The file's leading bytes are checked against the format its extension names
(`matchesFileSignature` in `lib/_upload_validation.ts`): JPEG, PNG, GIF, WebP, PDF, the legacy
Office (OLE2) header for `doc` and `xls`, and the ZIP header for `zip`, `docx` and `xlsx`. A `csv` or
`txt` file must hold no NUL byte. A file that fails answers `400 Invalid file type.`. An extension
added to the extension list that has no signature here cannot be verified and is accepted on the
allow-lists alone. Images are not re-encoded.

The size limit is `UPLOAD_MAX_BYTES` (default 10 MiB) and is applied before the body is parsed:
`POST /api/upload` refuses a declared `Content-Length` over the limit (plus 64 KiB of multipart
framing) without reading the body, and counts the bytes of a body that has no `Content-Length` while it
streams. The answer is `413`.

Tests: `lib/_upload_validation.test.ts` (every allow-listed extension and MIME type, the
rejection cases, the environment variables, the content signatures, the bounded body read) and
`code_generator/tests/test_upload_route_content_type.py` (the route uses the shared check, stores the
derived type, reads the body with a limit and checks the signature) and
`cypress/e2e/api/upload_path_safety.cy.ts` (a mismatched file and an oversized upload are refused).
