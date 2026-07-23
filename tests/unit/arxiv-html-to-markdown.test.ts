import { describe, expect, it } from 'vitest'
import { convertArxivHtmlToMarkdown } from '../../src/main/services/arxivHtmlToMarkdown'

describe('convertArxivHtmlToMarkdown', () => {
  it('converts arXiv article content to sanitized Markdown with formulas and absolute links', () => {
    const result = convertArxivHtmlToMarkdown(`
      <html>
        <head>
          <meta name="citation_title" content="A Test Paper">
          <style>.hidden { display: none }</style>
        </head>
        <body>
          <nav>Page navigation</nav>
          <article class="ltx_document">
            <h1>A Test Paper</h1>
            <section>
              <h2>Method</h2>
              <p>See <a href="/abs/2401.12345">the record</a> and
                <math alttext="x+y"><annotation encoding="application/x-tex">x + y</annotation></math>.
              </p>
              <div class="ltx_equation">
                <math display="block"><annotation encoding="application/x-tex">E = mc^2</annotation></math>
              </div>
              <script>window.bad = true</script>
            </section>
          </article>
        </body>
      </html>
    `, 'https://arxiv.org/html/2401.12345')

    expect(result.title).toBe('A Test Paper')
    expect(result.markdown).toContain('# A Test Paper')
    expect(result.markdown).toContain('## Method')
    expect(result.markdown).toContain('[the record](https://arxiv.org/abs/2401.12345)')
    expect(result.markdown).toContain('$x + y$')
    expect(result.markdown).toContain('$$\nE = mc^2\n$$')
    expect(result.markdown).not.toContain('window.bad')
    expect(result.markdown).not.toContain('Page navigation')
    expect(result.sections.map((section) => section.title)).toEqual(['A Test Paper', 'Method'])
    expect(result.warnings).toEqual([])
  })

  it('reports a conversion warning when MathML has no TeX representation', () => {
    const result = convertArxivHtmlToMarkdown(
      '<article><h1>Paper</h1><p><math><mi>x</mi></math></p></article>',
      'https://arxiv.org/html/2401.12345'
    )

    expect(result.warnings).toEqual(['A formula could not be converted to TeX.'])
  })
})
