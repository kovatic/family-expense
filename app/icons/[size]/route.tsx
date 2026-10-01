import { ImageResponse } from 'next/og'
import { AppIcon } from '@/components/AppIcon'

export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === '192' ? 192 : 512
  return new ImageResponse(<AppIcon size={size} />, { width: size, height: size })
}
