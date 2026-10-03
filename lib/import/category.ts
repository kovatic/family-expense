// Default merchant → category rules, applied after the user's own rules. Category names
// must exist in the categories table; if an admin removed one, the merchant goes to review.
export const DEFAULT_MERCHANT_CATEGORIES: Record<string, string> = {
  SWIGGY: 'Food & Dining',
  ZOMATO: 'Food & Dining',
  AMAZON: 'Shopping',
  FLIPKART: 'Shopping',
  MYNTRA: 'Shopping',
  DMART: 'Groceries',
  BIGBASKET: 'Groceries',
  BLINKIT: 'Groceries',
  ZEPTO: 'Groceries',
  JIOMART: 'Groceries',
  UBER: 'Transport',
  OLA: 'Transport',
  RAPIDO: 'Transport',
  IRCTC: 'Transport',
  NETFLIX: 'Entertainment',
  BOOKMYSHOW: 'Entertainment',
  AIRTEL: 'Bills & Utilities',
}

export type CategoryMatch = { category: string; source: 'USER_RULE' | 'DEFAULT_RULE' } | null

export function assignCategory(
  merchant: string | null,
  userRules: Map<string, string>,
  categories: string[],
): CategoryMatch {
  if (!merchant) return null
  const existing = (name: string | undefined) =>
    name ? categories.find((c) => c.toLowerCase() === name.toLowerCase()) ?? null : null
  const user = existing(userRules.get(merchant))
  if (user) return { category: user, source: 'USER_RULE' }
  const fallback = existing(DEFAULT_MERCHANT_CATEGORIES[merchant])
  if (fallback) return { category: fallback, source: 'DEFAULT_RULE' }
  return null
}
