// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CellContentDialog from '../../app/components/CellContentDialog.vue'

const jsonColumn = {
  name: 'document', nativeType: 'jsonb', type: 'json' as const, nullable: true, editable: true,
}

describe('CellContentDialog', () => {
  it('prettifies JSON, reports invalid input and emits a parsed preview value', async () => {
    const w = await mountSuspended(CellContentDialog, {
      props: { column: jsonColumn, rowNumber: 3, value: { active: true }, nullable: true, editable: true },
    })
    expect(w.get('[role="dialog"]').attributes('aria-label')).toBe('檢視與編輯 document 第 3 列')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toContain('"active": true')

    await w.get('textarea').setValue('{')
    await w.get('form').trigger('submit')
    expect(w.get('[role="alert"]').text()).toContain('有效的 JSON')
    expect(w.emitted('preview')).toBeUndefined()

    await w.get('textarea').setValue('{"count":2}')
    await w.findAll('button').find(button => button.text() === '格式化')!.trigger('click')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toContain('\n  "count": 2\n')
    await w.get('form').trigger('submit')
    expect(w.emitted('preview')).toEqual([[{ count: 2 }]])
  })

  it('validates PostgreSQL arrays and can preview NULL', async () => {
    const w = await mountSuspended(CellContentDialog, {
      props: {
        column: { ...jsonColumn, name: 'tags', nativeType: '_text', type: 'array' },
        rowNumber: 1, value: ['a'], nullable: true, editable: true,
      },
    })
    await w.get('textarea').setValue('{"not":"array"}')
    await w.get('form').trigger('submit')
    expect(w.get('[role="alert"]').text()).toContain('JSON array 格式')

    await w.get('input[type="checkbox"]').setValue(true)
    await w.get('form').trigger('submit')
    expect(w.emitted('preview')).toEqual([[null]])
  })

  it('keeps unsafe cells view-only while still showing complete content', async () => {
    const w = await mountSuspended(CellContentDialog, {
      props: { column: jsonColumn, rowNumber: 1, value: { secret: false }, nullable: true, editable: false },
    })
    expect(w.get('textarea').attributes('readonly')).toBeDefined()
    expect(w.text()).toContain('僅供檢視')
    expect(w.findAll('button').some(button => button.text() === '預覽寫入')).toBe(false)
  })
})
