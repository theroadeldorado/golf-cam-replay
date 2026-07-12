import { NextRequest, NextResponse } from 'next/server'
import {
  receiveSignals,
  sendSignal,
  SESSION_ID_PATTERN,
  type SignalMessage,
  type SignalRole,
} from '@/lib/signaling'

export const dynamic = 'force-dynamic'

const VALID_ROLES: SignalRole[] = ['desktop', 'phone']
const VALID_TYPES = new Set(['offer', 'answer', 'candidate', 'bye', 'ping'])
const MAX_PAYLOAD_BYTES = 32 * 1024

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  if (rateLimitMap.size > 2000) {
    for (const [key, val] of rateLimitMap) {
      if (val.resetAt < now) rateLimitMap.delete(key)
    }
  }
  const entry = rateLimitMap.get(ip)
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  if (entry.count >= 300) return true
  entry.count++
  return false
}

function validatePayload(type: string, payload: unknown): boolean {
  switch (type) {
    case 'offer':
    case 'answer':
      return typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).sdp === 'string'
    case 'candidate':
      return payload === null || (typeof payload === 'object' && payload !== null)
    case 'bye':
    case 'ping':
      return true
    default:
      return false
  }
}

interface RouteParams {
  params: Promise<{ session: string; role: string }>
}

function validate(session: string, role: string): NextResponse | null {
  if (!SESSION_ID_PATTERN.test(session)) {
    return NextResponse.json({ error: 'invalid session id' }, { status: 400, headers: CORS_HEADERS })
  }
  if (!VALID_ROLES.includes(role as SignalRole)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400, headers: CORS_HEADERS })
  }
  return null
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

/** The caller (`role`) posts a message for the other side. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ip = request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: CORS_HEADERS })
  }

  const { session, role } = await params
  const invalid = validate(session, role)
  if (invalid) return invalid

  const body = await request.text()
  if (body.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413, headers: CORS_HEADERS })
  }

  let message: SignalMessage
  try {
    message = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400, headers: CORS_HEADERS })
  }
  if (!VALID_TYPES.has(message.type)) {
    return NextResponse.json({ error: 'invalid message type' }, { status: 400, headers: CORS_HEADERS })
  }
  if (!validatePayload(message.type, message.payload)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400, headers: CORS_HEADERS })
  }

  await sendSignal(session, role as SignalRole, {
    type: message.type,
    payload: message.payload,
    sentAt: Date.now(),
  })
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
}

/** The caller (`role`) drains its inbox: GET ?since=<last seen seq>. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { session, role } = await params
  const invalid = validate(session, role)
  if (invalid) return invalid

  const since = Math.max(0, Number(request.nextUrl.searchParams.get('since') ?? 0) || 0)
  const messages = await receiveSignals(session, role as SignalRole, since)
  return NextResponse.json({ messages }, { headers: CORS_HEADERS })
}
