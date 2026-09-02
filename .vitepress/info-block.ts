/**
 * Custom block icon plugin for markdown-it.
 *
 * Changes `::: info`, `::: tip`, and `::: danger` blocks without a custom title.
 * It removes the default heading.
 * It adds a `data-*-icon` attribute for the CSS border icon.
 *
 * It does not change blocks with custom titles.
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
