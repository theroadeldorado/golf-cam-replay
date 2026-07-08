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

interface RouteParams {
  params: Promise<{ session: string; role: string }>
}

function validate(session: string, role: string): NextResponse | null {
  if (!SESSION_ID_PATTERN.test(session)) {
    return NextResponse.json({ error: 'invalid session id' }, { status: 400 })
  }
  if (!VALID_ROLES.includes(role as SignalRole)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }
  return null
}

/** The caller (`role`) posts a message for the other side. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { session, role } = await params
  const invalid = validate(session, role)
  if (invalid) return invalid

  const body = await request.text()
  if (body.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 })
  }

  let message: SignalMessage
  try {
    message = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (!VALID_TYPES.has(message.type)) {
    return NextResponse.json({ error: 'invalid message type' }, { status: 400 })
  }

  await sendSignal(session, role as SignalRole, {
    type: message.type,
    payload: message.payload,
    sentAt: Date.now(),
  })
  return NextResponse.json({ ok: true })
}

/** The caller (`role`) drains its inbox: GET ?since=<last seen seq>. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { session, role } = await params
  const invalid = validate(session, role)
  if (invalid) return invalid

  const since = Math.max(0, Number(request.nextUrl.searchParams.get('since') ?? 0) || 0)
  const messages = await receiveSignals(session, role as SignalRole, since)
  return NextResponse.json({ messages })
}
