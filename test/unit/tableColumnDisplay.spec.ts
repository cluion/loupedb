// @vitest-environment nuxt
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  reconcileTableColumnDisplay,
  restoreTableColumnDisplay,
  useTableColumnDisplay,
  type TableColumnDisplaySettings,
} from '../../app/stores/tableColumnDisplay'

const saved: TableColumnDisplaySettings = {
  order: ['label', 'id'],
  hidden: ['id'],
  widths: { label: 240 },
  frozenCount: 1,
}

beforeEach(() => localStorage.clear())

describe('table column display settings', () => {
  it('round-trips valid settings and rejects malformed payloads', () => {
    expect(restoreTableColumnDisplay(JSON.stringify(saved))).toEqual(saved)
    expect(restoreTableColumnDisplay('{broken')).toBeNull()
    expect(restoreTableColumnDisplay(JSON.stringify({ ...saved, order: ['id', 'id'] }))).toBeNull()
    expect(restoreTableColumnDisplay(JSON.stringify({ ...saved, widths: { id: 40 } }))).toBeNull()
    expect(restoreTableColumnDisplay(JSON.stringify({ ...saved, frozenCount: -1 }))).toBeNull()
  })

  it('reconciles removed and new schema columns while preserving valid choices', () => {
    const reconciled = reconcileTableColumnDisplay({
      order: ['gone', 'label'],
      hidden: ['gone', 'label'],
      widths: { gone: 300, label: 220 },
      frozenCount: 9,
    }, ['id', 'label', 'created_at'])
    expect(reconciled).toEqual({
      order: ['label', 'id', 'created_at'],
      hidden: ['label'],
      widths: { label: 220 },
      frozenCount: 2,
    })
  })

  it('always leaves at least one visible column', () => {
    expect(reconcileTableColumnDisplay({
      order: ['id', 'label'], hidden: ['id', 'label'], widths: {}, frozenCount: 2,
    }, ['id', 'label'])).toMatchObject({ hidden: ['label'], frozenCount: 1 })
  })

  it('clamps widths to the supported range', () => {
    expect(clampColumnWidth(1)).toBe(MIN_COLUMN_WIDTH)
    expect(clampColumnWidth(250.6)).toBe(251)
    expect(clampColumnWidth(1000)).toBe(MAX_COLUMN_WIDTH)
    expect(clampColumnWidth(Number.NaN)).toBe(DEFAULT_COLUMN_WIDTH)
  })

  it('persists explicit changes per table scope and reset removes them', () => {
    const scope = 'prod:appdb:public.items'
    const display = useTableColumnDisplay(scope)
    display.reconcile(['id', 'label'])
    const key = 'loupedb:table-column-display:v1:prod%3Aappdb%3Apublic.items'
    expect(localStorage.getItem(key)).toBeNull()

    display.update(saved)
    expect(restoreTableColumnDisplay(localStorage.getItem(key)!)).toEqual(saved)
    expect(useTableColumnDisplay(scope).settings.value).toEqual(saved)

    display.reset(['id', 'label'])
    expect(display.settings.value).toEqual({
      order: ['id', 'label'], hidden: [], widths: {}, frozenCount: 0,
    })
    expect(localStorage.getItem(key)).toBeNull()
  })
})
