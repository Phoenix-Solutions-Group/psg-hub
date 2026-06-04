import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, canAccessShop } from '@/lib/auth'
import { getPaginatedShopComments } from '@/lib/supabase/data'

interface RouteParams {
  params: Promise<{ shopName: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const result = await getAuthenticatedProfile(request)
  if (result instanceof NextResponse) return result

  const { shopName } = await params
  const decodedShopName = decodeURIComponent(shopName)

  if (!canAccessShop(result, decodedShopName)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Access denied to this shop' } },
      { status: 403 }
    )
  }

  const { searchParams } = request.nextUrl
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10)))
  const search = searchParams.get('search') || null

  // No caching for comments per TechSpec.
  const response = await getPaginatedShopComments(decodedShopName, search, page, pageSize)
  return NextResponse.json(response)
}
