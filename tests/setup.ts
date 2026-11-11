/**
 * Shared test setup. Runs for every test file (node and jsdom).
 *
 * Component tests opt into jsdom with a per-file docblock:
 *   // @vitest-environment jsdom
 *
 * The guards below are no-ops in the node environment; in jsdom they supply
 * the few browser APIs Reader.tsx relies on that jsdom does not implement.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Keep each component test isolated: without this, DOM from a previous case
// stays mounted and getByRole sees duplicate buttons.
afterEach(() => { if (typeof document !== 'undefined') cleanup() })

declare global {
  // eslint-disable-next-line no-var
  var __TEST_ENV__: string | undefined
}

// Mark environment so individual tests can skip browser-only setup.
globalThis.__TEST_ENV__ = typeof document !== 'undefined' ? 'jsdom' : 'node'

if (typeof document !== 'undefined') {
  // jsdom has no layout, so getBoundingClientRect returns all zeros. Tests
  // stub it where coordinates matter; here we only make it callable.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () { /* no-op in jsdom */ }
  }

  // CSS.escape is used to build a selector for the reading-anchor element.
  if (typeof CSS === 'undefined') {
    ;(globalThis as unknown as { CSS: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') }
  } else if (!CSS.escape) {
    ;(CSS as unknown as { escape: (s: string) => string }).escape = (s: string) =>
      s.replace(/([^\w-])/g, '\\$1')
  }

  // caretRangeFromPoint / caretPositionFromPoint: Reader's left-click path.
  // Tests override these per-case; a safe default keeps unrelated tests green.
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (!doc.caretRangeFromPoint && !doc.caretPositionFromPoint) {
    doc.caretRangeFromPoint = () => null
  }

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number
    window.cancelAnimationFrame = (id: number) => clearTimeout(id)
  }
}
