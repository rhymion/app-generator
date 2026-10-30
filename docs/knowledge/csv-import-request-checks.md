# CSV Import: Request Content-Type and Null-Byte Checks

`POST /api/<entity>/import` (`api_import_route.ts.jinja2`) carries the CSV as the `csv` string of a JSON body. Two
checks run before the CSV is parsed:

- **Content-Type.** The request's declared type (parameters such as `charset` ignored, case-insensitive) must be
  `application/json` or `text/plain`; anything else, or no header, is answered with HTTP 415 and the error code
  `UNSUPPORTED_MEDIA_TYPE`. `text/plain` is accepted so a client that posts the same JSON body without a JSON header keeps
  working. The type of the file the user picked is not part of this check: the import modal reads the file as text and
  posts it as JSON, so a CSV chosen as `text/plain`, `text/csv` or with no type still imports.
- **Null byte.** A CSV string containing a NUL character is answered with HTTP 400 and the error code `INVALID_CSV`. CSV
  text never contains one; it marks binary content sent as CSV. There is no magic-byte parsing.

The size limit (`FILE_TOO_LARGE`) is applied first, so an oversized body is still reported as too large.

An entity whose import is not supported (`new` and `edit` both false) answers its fixed 400 without these checks.

## Coverage

- `code_generator/tests/test_import_template_branches.py::test_import_route_checks_content_type_and_null_byte` renders
  the template and asserts both checks precede reading the body and parsing.
- The generated API spec `cypress/e2e/api/<entity>_crud.cy.ts` (template `test_api_spec.cy.ts.jinja2`) has examples
  N10a (415 on a form Content-Type), N10b (a `text/plain` JSON body is not refused on type) and N10c (NUL in the CSV
  answers `INVALID_CSV`), for every entity whose import can update.
