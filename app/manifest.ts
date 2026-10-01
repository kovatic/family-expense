import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Family Expenses',
    short_name: 'Expenses',
    description: 'Track family spending against monthly and weekly budgets',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f7f9',
    theme_color: '#0f766e',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
