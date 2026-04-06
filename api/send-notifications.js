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

  const inRange = (apptDate, apptTime, target) => {
    const apptDT = new Date(`${apptDate}T${apptTime}`)
    const diff = Math.abs(apptDT.getTime() - target.getTime())
    return diff <= 30 * 60 * 1000 // ±30 minutos
  }

  const { data: appts } = await supabase
    .from('appointments')
    .select('*')
    .eq('status', 'confirmed')
    .in('appointment_date', [fmt(in24h), fmt(in2h)])

  const results = []

  for (const appt of appts || []) {
    const is24 = inRange(appt.appointment_date, appt.appointment_time, in24h)
    const is2 = inRange(appt.appointment_date, appt.appointment_time, in2h)
    if (!is24 && !is2) continue

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', appt.user_id)
      for (const appt of appts || []) {
    const is24 = inRange(appt.appointment_date, appt.appointment_time, in24h)
    const is2 = inRange(appt.appointment_date, appt.appointment_time, in2h)
    if (!is24 && !is2) continue
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', appt.user_id)
    console.log('user_id:', appt.user_id, 'subs:', subs?.length)
    for (const { subscription } of subs || []) {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: 'Clocks Estudio Barbería',
            body: is24
              ? `Recuerda: tienes cita mañana a las ${appt.appointment_time.slice(0,5)}h`
              : `Tu cita es en 2 horas, a las ${appt.appointment_time.slice(0,5)}h`,
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
