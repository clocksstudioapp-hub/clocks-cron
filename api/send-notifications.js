import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000)

  const fmt = d => d.toISOString().slice(0, 10)
  const fmtH = d => d.toTimeString().slice(0, 5)

  const { data: appts } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'confirmed')
    .in('appointment_date', [fmt(in24h), fmt(in2h)])

  const results = []

  for (const appt of appts || []) {
    const apptTime = appt.appointment_time.slice(0, 5)
    const is24 = appt.appointment_date === fmt(in24h) && apptTime === fmtH(in24h)
    const is2 = appt.appointment_date === fmt(in2h) && apptTime === fmtH(in2h)
    if (!is24 && !is2) continue

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', appt.user_id)

    results.push({ appt: appt.id, subs: subs?.length, is24, is2 })
  }

  res.json({ ok: true, checked: appts?.length, results })
}
