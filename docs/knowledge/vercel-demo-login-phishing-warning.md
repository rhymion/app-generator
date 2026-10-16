# Chrome phishing warning on a demo login page

## Behavior

A generated app deployed to a shared `*.vercel.app` subdomain can make Chrome
show "You entered your password on a site that may be phishing" when a real
user signs in. The warning is Chrome's password-reuse check, documented at
<https://support.google.com/chrome/answer/13844634>. It is not a defect in the
generated app and not proof that the deployment is compromised.

Chrome shows the warning only when both conditions hold:

1. The password typed is a duplicate of another password the browser has saved
   or synced.
2. The current page fails Chrome's live phishing heuristic.

Removing either condition stops the warning. The generator can only help with
the first one.

## Why a fresh demo deployment fails the second condition

- A new deployment on a shared hosting subdomain is an uncommon, low-traffic
  site.
- The generated login page is a bare email and password form with a short
  product-name heading. That is deliberate for a generic template, but it
  resembles the low-effort login pages phishing kits publish on shared hosting.
- `lib/site-config.ts` defaults to `noindex: true` because generated apps are
  mostly internal tools. A demo therefore has no search-engine history either,
  which reinforces the "uncommon site" signal. The default itself is correct.
- Google Safe Browsing classifies per subdomain, so two deployments on
  `*.vercel.app` can have different verdicts.

## What to do

- Use a custom domain, not the default `*.vercel.app` URL, before showing the
  real login flow to end users, especially users who may reuse a saved password.
- Give every deployment its own admin password. `SEED_ADMIN_PASSWORD` must not
  be shared between the apps one operator runs; see
  `seed-baseline-credential-hardening.md`. This is the fix for condition 1.
- If the warning appears anyway, look up the site at
  <https://transparencyreport.google.com/safe-browsing/search>. If the verdict
  is wrong, use Safe Browsing's "report incorrect phishing warning" flow.
