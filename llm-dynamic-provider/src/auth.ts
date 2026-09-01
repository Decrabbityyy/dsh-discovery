/**
 * Self-contained pi-ai auth adapters for the dynamic provider, mirroring the
 * harness's llm-pi-ai `auth.ts`. The npm package bundles these as private
 * functions (lib/index.js defines but does not export `credentialStoreFrom` /
 * `authContextFrom`), so this package carries its own copy over the same
 * public seams: `ctx.credentials` records and the launch environment.
 */

import { homedir } from 'node:os'
import { access } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import type { AuthContext, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import {
  credentialKey, credentialKeyId, credentialKeyScope, credentialRef, isCredentialKeySegment, isCredentialRefName,
} from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRecord, CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** Record scope every credential this adapter family stores is written under. */
export const RECORD_SCOPE = 'llm-dynamic-provider'

/** The record address for one pi-ai provider id (also the harness route key). */
export function recordKeyFor(providerId: string): CredentialKey {
  return credentialKey(RECORD_SCOPE, providerId)
}

/** The JSON image of one grant payload (explicit-undefined members dropped). */
function jsonImage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(entry => entry === undefined ? null : jsonImage(entry))
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const image: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) image[key] = jsonImage(member)
    }
    return image
  }
  return value
}

/** Translate a stored record into the credential pi-ai expects. */
function toPiCredential(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...record.key === undefined ? {} : { key: record.key },
      ...record.env === undefined ? {} : { env: { ...record.env } },
    }
  }
  return record.payload as Credential
}

/** Translate a pi-ai credential into the record to store. */
function toRecord(credential: Credential): CredentialRecord {
  if (credential.type === 'api_key') {
    return {
      kind: 'api-key',
      ...credential.key === undefined ? {} : { key: credential.key },
      ...credential.env === undefined ? {} : { env: { ...credential.env } },
    }
  }
  return { kind: 'grant', payload: jsonImage(credential) }
}

/** The credential service, or the failure that names what is missing. */
function writableStore(ctx: Context): CredentialProvider {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new LlmError(
      'llm-dynamic-provider: no credentials service is mounted; a provider login cannot persist — mount the'
      + ' credentials plugin or authenticate the route through apiKeyEnv (environment, not a stored credential)',
      'NO_CREDENTIAL_STORE',
    )
  }
  return credentials
}

/**
 * A pi-ai `CredentialStore` over the harness credential records.
 * @param ctx - the plugin context carrying the optional `ctx.credentials`.
 * @returns the store to hand `createModels()`.
 */
export function credentialStoreFrom(ctx: Context): CredentialStore {
  return {
    async read(providerId) {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return undefined
      if (!isCredentialKeySegment(providerId)) return undefined
      return toPiCredential(await credentials.readRecord(recordKeyFor(providerId)))
    },
    async list(): Promise<readonly CredentialInfo[]> {
      const stored = await ctx.get('credentials')?.listRecords() ?? []
      const mine: CredentialInfo[] = []
      for (const entry of stored) {
        if (credentialKeyScope(entry.key) !== RECORD_SCOPE) continue
        mine.push({
          providerId: credentialKeyId(entry.key),
          type: entry.kind === 'api-key' ? 'api_key' : 'oauth',
        })
      }
      return mine
    },
    async modify(providerId, mutate) {
      if (!isCredentialKeySegment(providerId)) {
        throw new LlmError(
          `llm-dynamic-provider: provider id "${providerId}" cannot address a stored credential record (a record id`
          + ' is a lowercase hyphenated identifier); authenticate this route through apiKeyEnv instead of a stored'
          + ' credential',
          'UNSTORABLE_PROVIDER_ID',
        )
      }
      const stored = await writableStore(ctx).modifyRecord(recordKeyFor(providerId), async (current) => {
        const next = await mutate(toPiCredential(current))
        return next === undefined ? undefined : toRecord(next)
      })
      return toPiCredential(stored)
    },
    async delete(providerId) {
      if (!isCredentialKeySegment(providerId)) return
      await writableStore(ctx).deleteRecord(recordKeyFor(providerId))
    },
  }
}

/**
 * A pi-ai `AuthContext` over the harness credential plane and the host
 * filesystem.
 * @param ctx - the plugin context carrying the optional `ctx.credentials`.
 * @returns the auth context to hand `createModels()`.
 */
export function authContextFrom(ctx: Context): AuthContext {
  return {
    async env(name) {
      if (isCredentialRefName(name)) {
        const credentials = ctx.get('credentials')
        const hit = await credentials?.resolve(credentialRef(name))
        if (hit !== undefined) return hit.value
      }
      return launchEnvironmentOf(ctx).get(name)?.value
    },
    async fileExists(path) {
      const expanded = path.startsWith('~/') || path === '~'
        ? resolvePath(homedir(), path.slice(1).replace(/^\//, ''))
        : path
      try {
        await access(expanded)
        return true
      } catch {
        return false
      }
    },
  }
}
