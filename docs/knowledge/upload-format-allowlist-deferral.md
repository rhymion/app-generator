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

The file's bytes are not inspected (no magic-byte check). The extension and declared type
must agree with the allow-lists, and the served type comes from the extension, but a file's
content is not verified to match its extension.

Tests: `lib/_upload_validation.test.ts` (every allow-listed extension and MIME type, the
rejection cases, the environment variables) and
`code_generator/tests/test_upload_route_content_type.py` (both routes use the shared check
and store the derived type).
