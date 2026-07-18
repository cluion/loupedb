// @vitest-environment nuxt
import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WorkspaceHeader from '../../app/components/WorkspaceHeader.vue'

describe('WorkspaceHeader', () => {
  it('shows the wordmark and connection label', async () => {
    const w = await mountSuspended(WorkspaceHeader, {
      props: { connectionLabel: 'local', environment: 'production', safetyMode: 'safe' },
    })
    expect(w.text()).toContain('LoupeDB')
    expect(w.text()).toContain('local')
    expect(w.text()).toContain('PRODUCTION')
    expect(w.text()).toContain('SAFE MODE')
  })

  it('emits disconnect when the button is clicked', async () => {
    const w = await mountSuspended(WorkspaceHeader, {
      props: { connectionLabel: 'local', environment: 'development', safetyMode: 'normal' },
    })
    await w.findAll('button').find(b => b.text() === '中斷連線')!.trigger('click')
    expect(w.emitted('disconnect')).toHaveLength(1)
  })
})
