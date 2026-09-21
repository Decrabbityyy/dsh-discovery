/** 目录条目的展示格式：容量缩写与档位方块。 */

/** 方块代表的档位，从左到右；`off` 不占格（它是「可以关掉思考」，不是一档能力）。 */
const SQUARE_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** 容量的紧凑写法：`272k`、`1m`；小于一千写原值，非正数当没有。 */
export function formatCapacity(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  if (value >= 1_000_000) {
    const millions = Math.round(value / 100_000) / 10
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}m`
  }
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

/** 一行里的两个容量：`1m/128k`；缺哪一个就只写另一个，都没有写破折号。 */
export function formatCapacityPair(contextWindow: number | undefined, maxTokens: number | undefined): string {
  const pair = [formatCapacity(contextWindow), formatCapacity(maxTokens)]
    .filter((part): part is string => part !== undefined)
  return pair.length === 0 ? '—' : pair.join('/')
}

/** 六个方块各自亮不亮：minimal/low/medium/high/xhigh/max 依次；一个都没记录就全是暗的。 */
export function levelMarks(levels: readonly string[]): readonly boolean[] {
  return SQUARE_LEVELS.map((level) => levels.includes(level))
}
