// Wallet glyph rendered by next/og for PWA, favicon and Apple touch icons.
export function AppIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: '#0f766e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="5" width="20" height="15" rx="3" fill="#ffffff" />
        <path d="M5 5 L16 2 L17 5" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="14" y="10" width="8" height="5" rx="2" fill="#99f6e4" />
        <circle cx="17" cy="12.5" r="1.1" fill="#0f766e" />
      </svg>
    </div>
  )
}
