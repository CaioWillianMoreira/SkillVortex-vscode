import { useEffect, useState } from 'react'

const pageSize = 6

export function useCardPagination<T>(items: readonly T[], resetKey: string) {
  const [selection, setSelection] = useState({ key: resetKey, current: 1 })
  const current = selection.key === resetKey
    ? Math.min(selection.current, Math.max(1, Math.ceil(items.length / pageSize))) : 1

  useEffect(() => {
    setSelection(previous => previous.key === resetKey && previous.current === current
      ? previous : { key: resetKey, current })
  }, [resetKey, current])

  return {
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
    pagination: {
      current, pageSize, total: items.length, hideOnSinglePage: true,
      showSizeChanger: false, responsive: true,
      onChange: (page: number) => setSelection({ key: resetKey, current: page })
    }
  }
}
