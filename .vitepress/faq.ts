/**
 * FAQ plugin for markdown-it.
 *
 * Adds the `::: question` container.
 * The plugin collects questions and renders `<details>` elements by heading level.
 *
 * Frontmatter `faqLevel` controls grouping.
 *   1 (default): Insert after each h1 section.
 *   2: Insert after each h2 section.
 *   0: Insert at the end of the page.
 *   false: Keep questions at their source locations.
 *
 * The inline block rule uses the markdown-it-container algorithm.
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
  // Parse `::: question` blocks with the markdown-it-container algorithm.
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

  // Use inline renderers when `faqLevel` is false.
  md.renderer.rules['container_question_open'] = (tokens, idx) => {
    const title = tokens[idx].info.slice('question'.length).trim()
    return `<details class="faq-item">\n<summary>${md.renderInline(title)}</summary>\n<div class="faq-answer">\n`
  }
  md.renderer.rules['container_question_close'] = () => {
    return `</div>\n</details>\n`
  }

  // Collect question blocks and group them by heading level.
  md.core.ruler.push('faq-collect', (state) => {
    const tokens = state.tokens
    const faqLevel = state.env?.frontmatter?.faqLevel

    // Do not collect questions when `faqLevel` is false.
    if (faqLevel === false) return

    const level = (faqLevel ?? 1) as number
    const questions: FaqQuestion[] = []

    // First, replace extracted questions with markers.
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

    // Then insert FAQ blocks at section boundaries.
    // Level 0 puts all questions at the end.
    // Level 1 inserts questions before each h1.
    // Level 2 inserts questions before each h2.
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

    // Insert remaining questions at the end.
    if (sectionQuestions.length > 0) {
      newTokens.push(...buildFaqTokens(state, sectionQuestions, md))
    }

    state.tokens = newTokens
  })
}
