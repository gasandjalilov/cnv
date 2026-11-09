import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface TooltipState {
  text: string
  x: number
  y: number
}

export function InstantTooltip(): React.JSX.Element | null {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const hide = (): void => {
      targetRef.current = null
      setTooltip(null)
    }

    const convertTitle = (element: HTMLElement): void => {
      const title = element.getAttribute('title')
      if (title === null) return
      element.dataset.tooltip = title
      element.removeAttribute('title')

      const ownsLabel = element.dataset.tooltipAriaLabel === 'true'
      const needsLabel =
        element.matches('button, a, [role="button"]') &&
        !element.hasAttribute('aria-label') &&
        !(element.textContent ?? '').trim()
      if (title.trim() && (ownsLabel || needsLabel)) {
        element.setAttribute('aria-label', title)
        element.dataset.tooltipAriaLabel = 'true'
      } else if (!title.trim() && ownsLabel) {
        element.removeAttribute('aria-label')
        delete element.dataset.tooltipAriaLabel
      }

      if (targetRef.current === element) {
        if (title.trim()) setTooltip((current) => (current ? { ...current, text: title } : current))
        else hide()
      }
    }

    const scan = (root: ParentNode): void => {
      if (root instanceof HTMLElement) convertTitle(root)
      root.querySelectorAll<HTMLElement>('[title]').forEach(convertTitle)
    }

    scan(document)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') convertTitle(record.target as HTMLElement)
        for (const node of record.addedNodes) if (node instanceof HTMLElement) scan(node)
      }
    })
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title']
    })

    const showAtPointer = (event: PointerEvent): void => {
      const origin = event.target
      const target = origin instanceof Element ? origin.closest<HTMLElement>('[data-tooltip]') : null
      const text = target?.dataset.tooltip?.trim()
      if (!target || !text) {
        hide()
        return
      }
      targetRef.current = target
      setTooltip({ text, x: event.clientX, y: event.clientY })
    }

    const showAtFocus = (event: FocusEvent): void => {
      const origin = event.target
      const target = origin instanceof Element ? origin.closest<HTMLElement>('[data-tooltip]') : null
      const text = target?.dataset.tooltip?.trim()
      if (!target || !text) return
      const rect = target.getBoundingClientRect()
      targetRef.current = target
      setTooltip({ text, x: rect.left + rect.width / 2, y: rect.bottom })
    }

    const hideOnLeave = (event: PointerEvent): void => {
      if (!event.relatedTarget) hide()
    }

    document.addEventListener('pointerover', showAtPointer)
    document.addEventListener('pointermove', showAtPointer)
    document.addEventListener('pointerout', hideOnLeave)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', showAtFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('wheel', hide, true)
    document.addEventListener('keydown', hide)
    window.addEventListener('blur', hide)

    return () => {
      observer.disconnect()
      document.removeEventListener('pointerover', showAtPointer)
      document.removeEventListener('pointermove', showAtPointer)
      document.removeEventListener('pointerout', hideOnLeave)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', showAtFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('wheel', hide, true)
      document.removeEventListener('keydown', hide)
      window.removeEventListener('blur', hide)
      document.querySelectorAll<HTMLElement>('[data-tooltip]').forEach((element) => {
        element.setAttribute('title', element.dataset.tooltip ?? '')
        delete element.dataset.tooltip
        if (element.dataset.tooltipAriaLabel === 'true') {
          element.removeAttribute('aria-label')
          delete element.dataset.tooltipAriaLabel
        }
      })
    }
  }, [])

  useLayoutEffect(() => {
    const element = tooltipRef.current
    if (!element || !tooltip) return
    const rect = element.getBoundingClientRect()
    const left = Math.max(8, Math.min(tooltip.x + 12, window.innerWidth - rect.width - 8))
    const below = tooltip.y + 18
    const top =
      below + rect.height <= window.innerHeight - 8 ? below : Math.max(8, tooltip.y - rect.height - 12)
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }, [tooltip])

  if (!tooltip) return null
  return (
    <div ref={tooltipRef} className="instant-tooltip" role="tooltip" data-testid="instant-tooltip">
      {tooltip.text}
    </div>
  )
}
