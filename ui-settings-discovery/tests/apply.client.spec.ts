/** Discovery section registration: slot declaration injection and fiber disposal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, SECTION_ID } from 'dsh-client-ui-settings-discovery/client'
import { DiscoverySection } from '../src/client/DiscoverySection.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // The apply path only captures the wire face; no call leaves this fake
  // until the section actually probes or adopts.
  ctx.provide('connection', { api: {} } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-discovery apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'connection'])
  })

  it('registers the discovery nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(DiscoverySection)
    expect(entry.options).toMatchObject({ id: SECTION_ID, order: 20 })
    expect(resolveSlotLabel(entry.options.label)).toBe('模型发现')
    const injected = (
      entry.inject as unknown as () => import('../src/client/DiscoverySection.tsx').DiscoverySectionInjected
    )()
    expect(injected.api).toBeDefined()

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(DiscoverySection)
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    // Declarer unload: the cascade removes our entry while our local
    // disposer variable goes stale.
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')[0]!.component).toBe(DiscoverySection)
  })

  it('disposes the registration with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })
})
