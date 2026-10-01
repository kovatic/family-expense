const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: process.env.NEXT_PUBLIC_CURRENCY || 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

export const money = (n: number) => formatter.format(n)

// Seeded into the categories table on first run; admins can change them in the app.
export const DEFAULT_CATEGORIES = [
  'Groceries',
  'Food & Dining',
  'Transport',
  'Bills & Utilities',
  'Shopping',
  'Health',
  'Education',
  'Entertainment',
  'Household',
  'Other',
] as const
