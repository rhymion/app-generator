import type { MDXComponents } from 'mdx/types'
import { MdxLink } from '@/components/MdxLink'

export function useMDXComponents(): MDXComponents {
  return {
    a: ({ href, children, ...props }) => (
      <MdxLink href={href} {...props}>{children}</MdxLink>
    ),
  }
}
