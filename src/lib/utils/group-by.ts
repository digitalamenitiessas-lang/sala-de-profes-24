/**
 * Group an array of items by a string field (typically `category`).
 * Returns a Record where keys are unique field values and values are arrays.
 */
export function groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
  return items.reduce(
    (acc, item) => {
      const k = String(item[key])
      if (!acc[k]) acc[k] = []
      acc[k].push(item)
      return acc
    },
    {} as Record<string, T[]>,
  )
}
