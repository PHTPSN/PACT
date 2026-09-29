export function subsets<T>(values: readonly T[]): T[][] {
  return Array.from({ length: 2 ** values.length }, (_, mask) =>
    values.filter((_, index) => (mask & (1 << index)) !== 0),
  )
}
