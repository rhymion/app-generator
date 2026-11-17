# Nuclei regression templates

Each template describes an externally observable condition that must **not** occur in a
running generated app. The weekly `Dynamic Scans` workflow (`.github/workflows/dynamic-scans.yml`)
starts an app and runs every template in `templates/` against it; any match fails the job.

## Run locally

```bash
nuclei -t security/nuclei/templates -u http://localhost:$PORT -disable-update-check
```

## Add a template

When a fixed exposure or misconfiguration can be checked from outside:

1. Add `templates/<short-name>.yaml`. Use `matchers` that match the *bad* condition, so a match
   means a regression. Keep one condition per file.
2. Prove it fires: run `security/nuclei/check_templates_fire.sh`, which starts a deliberately
   broken stand-in server and requires every template to match it. Add the new template's bad
   behavior to `security/nuclei/broken_app.py`.
3. Run it against a real generated app and confirm it reports nothing.

Templates never send credentials, so they only check what an anonymous visitor can observe.
