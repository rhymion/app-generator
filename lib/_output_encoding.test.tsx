// Proves that React escapes text and attribute values at the JSX interpreter boundary. The
// generated pages render stored user text only as JSX children or attribute values (never through
// dangerouslySetInnerHTML), so this is the guarantee the ASVS V1.1.2 row relies on; a framework
// change that stopped escaping would fail here.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "'><b>x</b>",
];

describe('JSX output encoding', () => {
  it.each(PAYLOADS)('escapes %j as a text child', (payload) => {
    const html = renderToStaticMarkup(<p>{payload}</p>);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;');
  });

  it.each(PAYLOADS)('escapes %j inside an attribute value', (payload) => {
    const html = renderToStaticMarkup(<a title={payload} data-x={payload} />);
    // The payload cannot close the attribute and open a new tag or attribute.
    expect(html).toMatch(/^<a title="[^"<>]*" data-x="[^"<>]*"><\/a>$/);
  });

  it('does not render a string containing markup as markup', () => {
    const html = renderToStaticMarkup(<div>{'<b>bold</b>'}</div>);
    expect(html).toBe('<div>&lt;b&gt;bold&lt;/b&gt;</div>');
  });
});
