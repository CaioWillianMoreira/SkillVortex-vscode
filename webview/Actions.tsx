import { Button } from 'antd'
import type { ButtonProps } from 'antd'

const icons = {
  build: 'M4 4h6v6H4zM14 4h6v6h-6zM9 14h6v6H9zM7 10v2h10v-2M12 12v2',
  archive: 'M3 12h5l2 3h4l2-3h5M5 5h14l2 7v7H3v-7zM12 3v7m-3-3 3 3 3-3',
  read: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  run: 'M8 5v14l11-7z',
  edit: 'm16 3 5 5M4 20l4-1L21 6l-3-3L5 16z',
  unlink: 'm9 15-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 5 0M15 9l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-5 0M3 3l18 18',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  folder: 'M3 7V4h6l2 3h10v13H3z',
  library: 'M3 4h4v16H3zM10 4h4v16h-4zM16 5l3-1 4 15-3 1z',
  search: 'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  back: 'm10 5-7 7 7 7M3 12h18',
  save: 'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
  import: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  add: 'M12 4v16M4 12h16',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 2v6h-6',
  backup: 'M4 3h16v18H4zM8 3v6h8V3M8 17h8',
  restore: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
  examples: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16',
  filter: 'M3 4h18l-7 8v7l-4 2v-9z',
  allowed: 'm5 12 4 4L20 5',
  blocked: 'm6 6 12 12M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
  note: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
  link: 'm10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M13 18a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
  mindcards: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'
}

export function ActionIcon({ action }: { action: keyof typeof icons }): React.JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={icons[action]} />
  </svg>
}

export function ActionButton({
  action, className = '', ...props
}: ButtonProps & { action: keyof typeof icons }): React.JSX.Element {
  return <Button {...props} className={`action-button action-${action} ${className}`}
    icon={<ActionIcon action={action} />} />
}
