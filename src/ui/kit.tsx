import type { ReactNode } from 'react'

export type Tone = '' | 'blue' | 'green' | 'red' | 'orange' | 'yellow' | 'purple'

export function Badge({ tone = '', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

const PATHS: Record<string, ReactNode> = {
  library: <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" /><path d="M8 2v20M11 7h6M11 11h6" /></>,
  reader: <><path d="M2 5h7a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H2z" /><path d="M22 5h-7a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h7z" /></>,
  focus: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  profile: <><path d="M3 20h18M6 20V10M11 20V4M16 20v-7M21 20v-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.56V21h-4v-.08a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3h4v.08a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.6.75 1 1.4 1H21v4h-.2a1.7 1.7 0 0 0-1.4 1z" /></>,
  back: <><path d="M19 12H5M12 19l-7-7 7-7" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  spark: <><path d="M12 2l2.2 6.4L20.5 11l-6.3 2.6L12 20l-2.2-6.4L3.5 11l6.3-2.6z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  flag: <><path d="M5 21V4M5 5h11l-1.5 3L16 11H5" /></>,
  shield: <><path d="M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5z" /><path d="M9 12l2 2 4-4" /></>,
  close: <><path d="M18 6L6 18M6 6l12 12" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  download: <><path d="M12 3v12M7 11l5 5 5-5M4 20h16" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></>,
  check: <><path d="M20 6L9 17l-5-5" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 9v5M12 17.5v.5" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  dot: <><circle cx="12" cy="12" r="4" /></>,
}

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS.dot}
    </svg>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'correct': return 'green'
    case 'incorrect': return 'red'
    case 'partial': return 'yellow'
    case 'insufficient': return ''
    case 'disputed': return 'purple'
    case 'independent-correct': return 'green'
    case 'assisted-correct': return 'blue'
    case 'unscored': return ''
    default: return ''
  }
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    correct: '正确', incorrect: '明确错误', partial: '部分理解', insufficient: '证据不足', disputed: '有争议',
    'independent-correct': '首次独立正确', 'assisted-correct': '提示后正确', unscored: '不计分',
    PASS: 'PASS', CLARIFY: 'CLARIFY', RETRY: 'RETRY', EXPLAIN: 'EXPLAIN', TRANSFER: 'TRANSFER',
  }
  return map[status] ?? status
}
