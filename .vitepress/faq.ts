/**
 * FAQ plugin for markdown-it.
 *
 * Adds `::: question` container — questions can be written anywhere in the article,
 * but are collected and rendered as `<details>` accordions grouped by heading level.
 *
 * Frontmatter `faqLevel` controls grouping:
 *   1 (default) — end of each h1 section (= end of page for single-h1 docs)
 *   2           — end of each h2 section
 *   0           — end of page regardless of headings
 *   false       — no collection, questions render in place as inline spoilers
 *
 * No external dependencies — block rule is implemented inline (same logic as markdown-it-container).
 */
import type MarkdownIt from 'markdown-it'

const COLON = 0x3A

interface FaqQuestion {
  title: string
  content: any[]
}

function buildFaqTokens(
  state: any,
  questions: FaqQuestion[],
  md: MarkdownIt,
): any[] {
  const result: any[] = []

  const open = new state.Token('html_block', '', 0)
  open.content = `<section class="faq-section">\n`
  result.push(open)

  for (const q of questions) {
    const detailsOpen = new state.Token('html_block', '', 0)
    detailsOpen.content = `<details class="faq-item">\n<summary>${md.renderInline(q.title)}</summary>\n<div class="faq-answer">\n`
    result.push(detailsOpen)

    result.push(...q.content)

    const detailsClose = new state.Token('html_block', '', 0)
    detailsClose.content = `</div>\n</details>\n`
    result.push(detailsClose)
  }

  const close = new state.Token('html_block', '', 0)
  close.content = `</section>\n`
  result.push(close)

  return result
}

export function faqPlugin(md: MarkdownIt) {
  // Block rule: parse ::: question blocks (same approach as markdown-it-container)
  md.block.ruler.before('fence', 'container_question', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]

    if (state.src.charCodeAt(start) !== COLON) return false

    let pos = start + 1
    while (pos <= max && state.src.charCodeAt(pos) === COLON) pos++

    const markerCount = pos - start
    if (markerCount < 3) return false

    const markup = state.src.slice(start, pos)
    const params = state.src.slice(pos, max).trim()

    if (!/^question\s+.+/.test(params)) return false
    if (silent) return true

    // Find closing :::
    let nextLine = startLine
    let autoClosed = false

    for (;;) {
      nextLine++
      if (nextLine >= endLine) break

      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
      const lineMax = state.eMarks[nextLine]

      if (lineStart < lineMax && state.sCount[nextLine] < state.blkIndent) break
      if (state.src.charCodeAt(lineStart) !== COLON) continue
      if (state.sCount[nextLine] - state.blkIndent >= 4) continue

      let closePos = lineStart + 1
      while (closePos <= lineMax && state.src.charCodeAt(closePos) === COLON) closePos++
      if (closePos - lineStart < markerCount) continue

      closePos = state.skipSpaces(closePos)
      if (closePos < lineMax) continue

      autoClosed = true
      break
    }

    const oldParent = state.parentType
    const oldLineMax = state.lineMax
    state.parentType = 'container' as any
    state.lineMax = nextLine

    const openToken = state.push('container_question_open', 'div', 1)
    openToken.markup = markup
    openToken.block = true
    openToken.info = params
    openToken.map = [startLine, nextLine]

    state.md.block.tokenize(state, startLine + 1, nextLine)

    const closeToken = state.push('container_question_close', 'div', -1)
    closeToken.markup = markup
    closeToken.block = true

    state.parentType = oldParent
    state.lineMax = oldLineMax
    state.line = nextLine + (autoClosed ? 1 : 0)

    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  // Inline renderers: used when faqLevel: false (questions stay in place)
  md.renderer.rules['container_question_open'] = (tokens, idx) => {
    const title = tokens[idx].info.slice('question'.length).trim()
    return `<details class="faq-item">\n<summary>${md.renderInline(title)}</summary>\n<div class="faq-answer">\n`
  }
  md.renderer.rules['container_question_close'] = () => {
    return `</div>\n</details>\n`
  }

  // Core rule: collect question blocks and group them by heading level
  md.core.ruler.push('faq-collect', (state) => {
    const tokens = state.tokens
    const faqLevel = state.env?.frontmatter?.faqLevel

    // faqLevel: false → questions render in place, skip collection
    if (faqLevel === false) return

    const level = (faqLevel ?? 1) as number
    const questions: FaqQuestion[] = []

    // Phase 1: Extract questions, replace with lightweight markers
    let i = 0
    while (i < tokens.length) {
      if (tokens[i].type === 'container_question_open') {
        const title = tokens[i].info.slice('question'.length).trim()
        const start = i
        let depth = 1
        i++
        const content: any[] = []

        while (i < tokens.length && depth > 0) {
          if (tokens[i].type === 'container_question_open') depth++
          if (tokens[i].type === 'container_question_close') depth--
          if (depth > 0) content.push(tokens[i])
          i++
        }

        const marker = new state.Token('faq_marker', '', 0)
        marker.meta = { questionIndex: questions.length }
        questions.push({ title, content })

        tokens.splice(start, i - start, marker)
        i = start + 1
      } else {
        i++
      }
    }

    if (questions.length === 0) return

    // Phase 2: Build new token array, inserting FAQ blocks at section boundaries
    // level=0 → tag "h0" matches nothing → all questions flush at the end
    // level=1 → flush before each h1 (typically one per page → end of page)
    // level=2 → flush before each h2
    const tag = `h${level}`
    const newTokens: any[] = []
    let sectionQuestions: FaqQuestion[] = []

    for (const token of tokens) {
      if (token.type === 'faq_marker') {
        sectionQuestions.push(questions[token.meta.questionIndex])
        continue
      }

      if (token.type === 'heading_open' && token.tag === tag && sectionQuestions.length > 0) {
        newTokens.push(...buildFaqTokens(state, sectionQuestions, md))
        sectionQuestions = []
      }

      newTokens.push(token)
    }

    // Flush remaining questions at the end
    if (sectionQuestions.length > 0) {
      newTokens.push(...buildFaqTokens(state, sectionQuestions, md))
    }

    state.tokens = newTokens
  })
}
