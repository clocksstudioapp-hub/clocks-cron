import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VITE_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
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

    for (const { subscription } of subs || []) {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: 'Clocks Estudio Barbería',
            body: is24
              ? `Recuerda: tienes cita mañana a las ${apptTime}h`
              : `Tu cita es en 2 horas, a las ${apptTime}h`,
            url: '/'
          })
        )
        results.push({ appt: appt.id, status: 'sent' })
      } catch (e) {
        results.push({ appt: appt.id, status: 'error', error: e.message })
      }
    }
  }

  res.json({ ok: true, checked: appts?.length, results })
}
