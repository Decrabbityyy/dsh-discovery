// @vitest-environment jsdom
/**
 * Discovery section registration: slot declaration injection and fiber disposal.
 *
 * `@deepseek-ai/dsh-client-runtime/client` ships as a `__ModuleLoader__`
 * bundle (the web shell's module seam), so the spec installs a minimal shim
 * before importing it: the loader registers the factory, the require face
 * forwards to the real packages, and the registered entry becomes the import.
 */
import * as cordis from '@deepseek-ai/cordis'
import * as uiSlots from '@deepseek-ai/dsh-client-ui-slots'

const __dshModules = new Map<string, (require: (id: string) => unknown) => unknown>()
;(globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = {
  load(entry: { id: string; factory: (require: (id: string) => unknown) => unknown }): void {
    __dshModules.set(entry.id, entry.factory)
  },
}
const __dshRequire = (id: string): unknown => {
  if (id === '@deepseek-ai/cordis') return cordis
  if (id === '@deepseek-ai/dsh-client-ui-slots') return uiSlots
  throw new Error(`__ModuleLoader__ shim: unstubbed require "${id}"`)
}
// The register call happens when the runtime bundle is evaluated below.
await import('@deepseek-ai/dsh-client-runtime/client')
const clientRuntime = __dshModules.get('@deepseek-ai/dsh-client-runtime')!(__dshRequire) as typeof import('@deepseek-ai/dsh-client-runtime/client')
const { SlotRegistry } = clientRuntime

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, SECTION_ID } from 'dsh-client-ui-settings-discovery/client'
import { DiscoverySection } from '../src/client/DiscoverySection.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // The apply path only captures the wire face; no call leaves this fake
  // until the section actually probes or adopts. The alpha.4 contract reads
  // the face from `ctx.remote`; `connection`/`locale`/`settingsScope` are
  // inject-ordering requirements the section never reads.
  ctx.provide('connection', { api: {} } as never)
  ctx.provide('remote', {} as never)
  // Nested remote faces are independent Cordis services and must be present
  // for the plugin fiber's explicit namespace injections to activate.
  ctx.provide('remote.llm', {} as never)
  ctx.provide('remote.settings', {} as never)
  ctx.provide('remote.credentials', {} as never)
  ctx.provide('locale', {} as never)
  ctx.provide('settingsScope', {} as never)
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
    expect(inject).toEqual([
      'slots',
      'locale',
      'connection',
      'remote',
      'remote.llm',
      'remote.settings',
      'remote.credentials',
      'settingsScope',
    ])
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
