import { readFileSync } from 'node:fs'
import ts from 'typescript'

/** Hidden clip geometry is layout, not an alternative icon system. Only allow
 * inert zero-size SVG defs; visible SVGs and arbitrary descendants stay checked. */
export function withoutDecorativeClipDefinitions(source: string): string {
  const file = ts.createSourceFile('contract.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const ranges: Array<[number, number]> = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'svg') {
      const attrs = Object.fromEntries(node.openingElement.attributes.properties
        .filter(ts.isJsxAttribute).map(attr => [attr.name.getText(file), attr.initializer?.getText(file)]))
      const hidden = attrs.width === '"0"' && attrs.height === '"0"'
        && attrs['aria-hidden'] === '"true"' && attrs.focusable === '"false"'
      let geometryOnly = hidden
      let hasClip = false
      const inspect = (child: ts.Node) => {
        if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
          const tag = child.tagName.getText(file)
          if (!['svg', 'defs', 'clipPath', 'path'].includes(tag)) geometryOnly = false
          if (tag === 'clipPath') hasClip = true
          const allowed = tag === 'svg' ? ['className', 'width', 'height', 'aria-hidden', 'focusable']
            : tag === 'clipPath' ? ['id', 'clipPathUnits'] : tag === 'path' ? ['d'] : []
          for (const attr of child.attributes.properties) {
            if (!ts.isJsxAttribute(attr) || !allowed.includes(attr.name.getText(file))
              || !attr.initializer || !ts.isStringLiteral(attr.initializer)) geometryOnly = false
          }
        }
        ts.forEachChild(child, inspect)
      }
      inspect(node)
      if (geometryOnly && hasClip) ranges.push([node.getStart(file), node.end])
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return ranges.reverse().reduce((text, [start, end]) => text.slice(0, start) + text.slice(end), source)
}

/**
 * Source-level contract tests intentionally ignore checkout line endings.
 * Git may materialize the same tracked source as LF or CRLF on Windows.
 */
export function normalizeSourceEol(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

/**
 * Read a tracked source file through the same canonical EOL boundary used by
 * source-contract assertions and content hashes.
 */
export function readNormalizedSource(sourcePath: string): string {
  return normalizeSourceEol(readFileSync(sourcePath, 'utf8'))
}
