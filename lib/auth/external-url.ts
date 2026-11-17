/**
 * The host and scheme the browser used to reach the app, for building redirect
 * URLs in proxy.ts.
 *
 * `x-forwarded-host`, `x-forwarded-proto` and `Host` are request headers, so a
 * client can send any value. They are only believed when the host they name is
 * one the deployment is configured to serve: the host of `AUTH_URL` /
 * `NEXTAUTH_URL`, a Vercel deployment host (`VERCEL_URL`, `VERCEL_BRANCH_URL`,
 * `VERCEL_PROJECT_PRODUCTION_URL`), or an entry of `AUTH_ALLOWED_HOSTS` (a
 * comma-separated list of host names, for extra custom domains). Anything else
 * is ignored and the redirect goes to the configured application URL, or to
 * the request's own URL when none is configured.
 */

export interface ExternalUrl {
  /** Scheme without the trailing colon: `http` or `https`. */
  protocol: string;
  /** Host, with a port only for plain http. */
  host: string;
}

export interface ExternalUrlInput {
  forwardedHost: string | null;
  forwardedProto: string | null;
  hostHeader: string | null;
  /** The request's own URL as Next.js parsed it. */
  nextUrl: URL;
  env?: Record<string, string | undefined>;
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function firstValue(header: string | null): string | null {
  const first = header?.split(',')[0]?.trim();
  return first ? first : null;
}

function configuredUrl(env: Record<string, string | undefined>): URL | null {
  const raw = env.AUTH_URL || env.NEXTAUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Host names this deployment is configured to serve, lower-cased, without ports. */
export function allowedHostnames(env: Record<string, string | undefined> = process.env): Set<string> {
  const names = new Set<string>();
  const add = (host: string | undefined) => {
    if (!host) return;
    const name = hostnameOf(host.trim());
    if (name) names.add(name);
  };
  const app = configuredUrl(env);
  if (app) names.add(app.hostname.toLowerCase());
  add(env.VERCEL_URL);
  add(env.VERCEL_BRANCH_URL);
  add(env.VERCEL_PROJECT_PRODUCTION_URL);
  for (const entry of (env.AUTH_ALLOWED_HOSTS ?? '').split(',')) add(entry);
  return names;
}

/** True when `host` (with or without a port) names a host the deployment serves. */
export function isAllowedHost(host: string, env: Record<string, string | undefined> = process.env): boolean {
  const name = hostnameOf(host);
  return name !== null && allowedHostnames(env).has(name);
}

/**
 * An https URL must never carry a port: Cloud Run forwards its internal
 * listening port in the Host header although the public connection is on 443.
 * Plain http keeps its port because local development relies on it.
 */
function stripPortForHttps(host: string, protocol: string): string {
  return protocol === 'https' ? host.replace(/:\d+$/, '') : host;
}

export function resolveExternalUrl(input: ExternalUrlInput): ExternalUrl {
  const env = input.env ?? process.env;
  const candidate = firstValue(input.forwardedHost) ?? firstValue(input.hostHeader) ?? input.nextUrl.host;
  const app = configuredUrl(env);

  if (isAllowedHost(candidate, env)) {
    const forwarded = firstValue(input.forwardedProto)?.toLowerCase();
    const protocol =
      forwarded === 'http' || forwarded === 'https'
        ? forwarded
        : app?.hostname.toLowerCase() === hostnameOf(candidate)
          ? app.protocol.replace(':', '')
          : input.nextUrl.protocol.replace(':', '');
    return { protocol, host: stripPortForHttps(candidate, protocol) };
  }

  // The headers name a host this deployment does not serve: ignore them.
  if (app) {
    const protocol = app.protocol.replace(':', '');
    return { protocol, host: stripPortForHttps(app.host, protocol) };
  }
  const protocol = input.nextUrl.protocol.replace(':', '');
  return { protocol, host: stripPortForHttps(input.nextUrl.host, protocol) };
}
