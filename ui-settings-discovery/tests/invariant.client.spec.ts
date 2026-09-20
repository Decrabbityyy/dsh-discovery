import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as DiscoveryInvariant from 'dsh-client-ui-settings-discovery/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { DiscoverySection } from '../src/client/DiscoverySection.tsx'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(DiscoveryInvariant).await()).resolves.toBeDefined()
  })

  it('renders null until the shell injects the section dependencies', () => {
    expect(DiscoverySection({})).toBeNull()
  })
})
