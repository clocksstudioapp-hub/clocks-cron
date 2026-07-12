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

// ── Zona horaria: las horas de cita se guardan como hora local de Madrid.
// El runtime de Vercel corre en UTC, así que convertimos explícitamente.
const TZ = 'Europe/Madrid'
function tzOffsetMs(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const p = {}
  dtf.formatToParts(date).forEach(x => { p[x.type] = x.value })
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour === '24' ? 0 : p.hour, p.minute, p.second)
  return asUTC - date.getTime()
}
// Instante UTC real de una "hora de pared" de Madrid (YYYY-MM-DD, HH:MM[:SS]).
function madridWallToInstant(dateStr, timeStr) {
  const hhmm = String(timeStr).slice(0, 5)
  const guess = new Date(`${dateStr}T${hhmm}:00Z`)
  return new Date(guess.getTime() - tzOffsetMs(guess))
}
// 'YYYY-MM-DD' de un instante, en Madrid.
function madridDateKey(date) {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  return dtf.format(date) // en-CA da YYYY-MM-DD
}

export default async function handler(req, res) {
  // ── Auth gate ──────────────────────────────────────────────────────────────
  // Corre con service_role (puentea RLS), así que NO puede ser público.
  // Vercel Cron envía "Authorization: Bearer <CRON_SECRET>". Aceptamos también
  // ?secret= para schedulers externos/manuales.
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers['authorization'] || ''
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query && req.query.secret) || ''
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const WINDOW = 30 * 60 * 1000
  const inRange = (apptDate, apptTime, target) =>
    Math.abs(madridWallToInstant(apptDate, apptTime).getTime() - target.getTime()) <= WINDOW

  // Fechas candidatas (en Madrid) para acotar la query.
  const dateKeys = [...new Set([madridDateKey(in24h), madridDateKey(in2h)])]
  const { data: appts } = await supabase
    .from('appointments')
    .select('id, user_id, appointment_date, appointment_time')
    .eq('status', 'confirmed')
    .in('appointment_date', dateKeys)

  const due = (appts || []).filter(a => {
    const is24 = inRange(a.appointment_date, a.appointment_time, in24h)
    const is2 = inRange(a.appointment_date, a.appointment_time, in2h)
    return (is24 || is2) && a.user_id
  }).map(a => ({ ...a, kind: inRange(a.appointment_date, a.appointment_time, in24h) ? 24 : 2 }))

  // Una sola query de subscripciones (evita N+1).
  const userIds = [...new Set(due.map(a => a.user_id))]
  const subsByUser = {}
  if (userIds.length) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('user_id, subscription')
      .in('user_id', userIds)
    ;(subs || []).forEach(s => { (subsByUser[s.user_id] ||= []).push(s.subscription) })
  }

  let sent = 0, errors = 0
  for (const a of due) {
    const hhmm = String(a.appointment_time).slice(0, 5)
    const body = a.kind === 24
      ? `Recuerda: tienes cita mañana a las ${hhmm}h`
      : `Tu cita es en 2 horas, a las ${hhmm}h`
    for (const subscription of subsByUser[a.user_id] || []) {
      try {
        await webpush.sendNotification(subscription, JSON.stringify({
          title: 'Clocks Estudio Barbería', body, url: '/',
        }))
        sent++
      } catch {
        errors++
      }
    }
  }

  // Solo contadores agregados: nunca user_id ni detalle por cita en logs.
  return res.status(200).json({ ok: true, checked: (appts || []).length, sent, errors })
}
