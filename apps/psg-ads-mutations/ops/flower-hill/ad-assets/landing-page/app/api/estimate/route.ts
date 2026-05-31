export async function POST(request: Request) {
  const body = await request.json()
  const { name, phone, email, vehicle, damage, concept } = body

  if (!name || !phone || !vehicle) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  console.log('Estimate request:', {
    name,
    phone,
    email: email || null,
    vehicle,
    damage: damage || null,
    concept,
    timestamp: new Date().toISOString(),
  })

  return Response.json({ success: true, message: 'We will call you within 2 hours.' })
}
