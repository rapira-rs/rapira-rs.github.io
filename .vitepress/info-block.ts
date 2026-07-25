/**
 * Custom block icon plugin for markdown-it.
 *
 * For `::: info`, `::: tip` and `::: danger` blocks without a custom title:
 * - Removes the default heading ("INFO" / "TIP" / "DANGER")
 * - Adds `data-*-icon` attribute so CSS can render an icon on the left border
 *
 * Blocks with custom titles (`::: info My Title`) are left untouched.
 */
import type MarkdownIt from 'markdown-it'

function wrapContainerRenderer(
  md: MarkdownIt,
  type: string,
  dataAttr: string,
) {
  const defaultRender = md.renderer.rules[`container_${type}_open`]

  md.renderer.rules[`container_${type}_open`] = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const title = token.info.trim().slice(type.length).trim()

    if (!title) {
      return `<div class="${type} custom-block" ${dataAttr}>\n`
    }

    if (defaultRender) {
      return defaultRender(tokens, idx, options, env, self)
    }

    return self.renderToken(tokens, idx, options)
  }
}

export function infoBlockPlugin(md: MarkdownIt) {
  wrapContainerRenderer(md, 'info', 'data-info-icon')
  wrapContainerRenderer(md, 'tip', 'data-tip-icon')
  wrapContainerRenderer(md, 'danger', 'data-danger-icon')
  wrapContainerRenderer(md, 'warning', 'data-warning-icon')
}
