import React from 'react'

// Lightweight, dependency-free renderer for AI chat output. Handles the markdown
// the models actually emit — **bold**, *italic*, `code`, simple - / * bullet
// lists — and gracefully degrades the phone-hostile stuff (tables, --- rules)
// instead of dumping raw asterisks and pipes into the bubble.

function renderInline(text: string, kb: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[2] != null) nodes.push(<strong key={`${kb}-b${i}`} className="font-semibold text-white">{m[2]}</strong>)
    else if (m[3] != null) nodes.push(<em key={`${kb}-i${i}`}>{m[3]}</em>)
    else if (m[4] != null) nodes.push(<code key={`${kb}-c${i}`} className="px-1 py-0.5 rounded bg-white/10 text-[0.88em]">{m[4]}</code>)
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export default function ChatText({ text, className, cursor }: { text: string; className?: string; cursor?: React.ReactNode }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let list: string[] = []

  const flushList = (key: string) => {
    if (!list.length) return
    const items = list
    list = []
    blocks.push(
      <ul key={`ul-${key}`} className="list-disc pl-4 space-y-0.5 my-1">
        {items.map((li, i) => <li key={i}>{renderInline(li, `${key}-${i}`)}</li>)}
      </ul>
    )
  }

  lines.forEach((raw, idx) => {
    const t = raw.trim()

    // Horizontal rule (---, ***, ___) → drop it
    if (/^([-*_])\1{2,}$/.test(t)) { flushList(`hr${idx}`); return }

    // Bullet line
    const bullet = t.match(/^[-*•]\s+(.*)/)
    if (bullet) { list.push(bullet[1]); return }

    flushList(`l${idx}`)

    if (!t) { blocks.push(<div key={`sp${idx}`} className="h-2" />); return }

    // Markdown table row → degrade to a plain dotted line; skip the |---| separator
    if (t.startsWith('|')) {
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      if (cells.every(c => c === '' || /^:?-{2,}:?$/.test(c))) return
      blocks.push(
        <p key={`tr${idx}`} className="my-0.5">
          {cells.filter(Boolean).map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-white/30"> · </span>}
              {renderInline(c, `tr${idx}-${i}`)}
            </React.Fragment>
          ))}
        </p>
      )
      return
    }

    blocks.push(<p key={`p${idx}`} className="my-0.5">{renderInline(t, `p${idx}`)}</p>)
  })
  flushList('end')

  // Streaming caret: tuck it inline at the end of the last paragraph so it
  // doesn't wrap onto its own line mid-stream.
  if (cursor != null) {
    const last = blocks[blocks.length - 1]
    if (React.isValidElement(last) && last.type === 'p') {
      const kids = (last.props as { children?: React.ReactNode }).children
      blocks[blocks.length - 1] = React.cloneElement(
        last as React.ReactElement<{ children?: React.ReactNode }>,
        {},
        ...(Array.isArray(kids) ? kids : [kids]),
        <React.Fragment key="cursor">{cursor}</React.Fragment>
      )
    } else {
      blocks.push(<span key="cursor">{cursor}</span>)
    }
  }

  return <div className={className}>{blocks}</div>
}
