// Known merchants matched anywhere in the narration or UPI handle. Unknown names are only
// tidied (case, prefixes, spacing), never guessed into a known brand.
const KNOWN_MERCHANTS: [string, RegExp][] = [
  ['SWIGGY', /\bswiggy/i],
  ['ZOMATO', /\bzomato/i],
  ['AMAZON', /\b(amazon|amzn)/i],
  ['FLIPKART', /\bflipkart/i],
  ['MYNTRA', /\bmyntra/i],
  ['DMART', /\b(d[\s-]?mart|avenue\s+supermarts)\b/i],
  ['BIGBASKET', /\b(big\s?basket|bbnow)\b/i],
  ['BLINKIT', /\b(blinkit|grofers)/i],
  ['ZEPTO', /\bzepto/i],
  ['JIOMART', /\bjio\s?mart/i],
  ['UBER', /\buber\b/i],
  ['OLA', /\b(ola|olacabs|ola\s+cabs|ani\s+technologies)\b/i],
  ['RAPIDO', /\brapido/i],
  ['IRCTC', /\birctc/i],
  ['NETFLIX', /\bnetflix/i],
  ['BOOKMYSHOW', /\bbook\s?my\s?show/i],
  ['AIRTEL', /\bairtel/i],
  ['TASMAC', /\btasmac\b/i],
]

const PREFIX = /^(upi|pos|imps|neft|rtgs|ecom|p2m|p2a|vps|ach)[\s/:*\-]+/i

export function normalizeMerchant(raw: string | null, upiId: string | null = null): string | null {
  for (const source of [raw, upiId?.split('@')[0] ?? null]) {
    if (!source) continue
    for (const [name, re] of KNOWN_MERCHANTS) if (re.test(source)) return name
  }
  if (!raw) return null
  let s = raw.toUpperCase().trim()
  while (PREFIX.test(s)) s = s.replace(PREFIX, '')
  s = s.replace(/\s+/g, ' ').replace(/^[\s*/.\-:]+|[\s*/.\-:]+$/g, '')
  return s || null
}
