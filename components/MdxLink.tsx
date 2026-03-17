'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

type Props = React.AnchorHTMLAttributes<HTMLAnchorElement>

export function MdxLink({ href, children, ...props }: Props) {
  const pathname = usePathname()

  if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('/')) {
    return <a href={href} {...props}>{children}</a>
  }

  // Treat the current URL as a directory so relative links resolve correctly.
  // e.g. at /en/docs, "booking" → /en/docs/booking (not /en/booking)
  const base = pathname.endsWith('/') ? pathname : pathname + '/'
  const resolved = new URL(href, `http://x${base}`).pathname

  return <Link href={resolved} {...props}>{children}</Link>
}
