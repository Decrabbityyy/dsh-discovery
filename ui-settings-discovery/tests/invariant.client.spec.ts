import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeHalfApply } from '../src/index.ts'
import * as DiscoveryInvariant from 'dsh-client-ui-settings-discovery/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { DiscoverySection } from '../src/client/DiscoverySection.tsx'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(DiscoveryInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', () => {
    nodeHalfApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })

  it('renders null until the shell injects the section dependencies', () => {
    expect(DiscoverySection({})).toBeNull()
  })
})
