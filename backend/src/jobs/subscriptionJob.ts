/**
 * @file jobs/subscriptionJob.ts
 * @module jobs
 * @description Background job: Check expired subscriptions daily and auto-suspend shops
 */
import { checkAndSuspendExpired } from '../services/subscription.service'

function log(level: 'info' | 'error', event: string, meta?: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, job: 'subscription', event, ...meta }))
}

/** Schedule subscription expiry check: every day at 02:00 UTC
 *  Runs sync on server startup, then repeats daily
 */
export function scheduleSubscriptionCheck(): void {
  // Run on startup
  checkAndSuspendExpired().then(count => {
    log('info', 'startup_check_complete', { suspendedCount: count })
  }).catch(err => {
    log('error', 'startup_check_failed', { error: String(err) })
  })

  // Schedule daily at 02:00 UTC
  const now = new Date()
  const targetTime = new Date()
  targetTime.setUTCHours(2, 0, 0, 0) // 2 AM UTC

  // If it's already past 2 AM today, schedule for tomorrow
  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1)
  }

  const delayMs = targetTime.getTime() - now.getTime()

  log('info', 'job_scheduled', {
    nextRunAt: targetTime.toISOString(),
    delayHours: Math.round(delayMs / 1000 / 3600)
  })

  setTimeout(() => {
    // Run the check
    checkAndSuspendExpired().then(count => {
      log('info', 'scheduled_check_complete', { suspendedCount: count })
    }).catch(err => {
      log('error', 'scheduled_check_failed', { error: String(err) })
    })

    // Reschedule for tomorrow
    setInterval(() => {
      checkAndSuspendExpired().then(count => {
        log('info', 'daily_check_complete', { suspendedCount: count })
      }).catch(err => {
        log('error', 'daily_check_failed', { error: String(err) })
      })
    }, 24 * 60 * 60 * 1000) // Every 24 hours
  }, delayMs)
}
