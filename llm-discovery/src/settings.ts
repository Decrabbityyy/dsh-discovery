/** 本插件的用户设置：注册进 settings 命名空间，页面上改完立即生效，不用重启。 */

import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { DISCOVERY_NS } from './vocabulary.ts'
import type { DiscoverySettingsSection } from './vocabulary.ts'

export type { DiscoverySettingsSection } from './vocabulary.ts'

/** 设置命名空间与探测 offer 同名，和动态路由插件同一套做法。 */
export const DISCOVERY_SETTINGS_NS = DISCOVERY_NS as SettingsNamespace

/** 用户层的字段；组成层的值（部署配置）由注册时的 `base` 提供。 */
export const DiscoverySettings: z<DiscoverySettingsSection> = z.object({
  catalogRefreshIntervalMinutes: z.number().step(1).min(0).default(0),
})
