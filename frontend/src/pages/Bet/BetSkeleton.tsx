/**
 * @file pages/Bet/BetSkeleton.tsx
 * @module pages/Bet
 * @description Skeleton ระหว่างโหลดรายการหวย — เลียนโครง section + card-grid
 *              กัน layout shift (CLS) และลด perceived load time
 */
import { Skeleton } from '@/components/Skeleton/Skeleton'

function CardSkeleton() {
  return (
    <div className="lottery-card lc-skel">
      <Skeleton width="100%" height="120px" radius="4px 4px 0 0" />
      <div className="lc-stripe" />
      <div className="lc-cd">
        <Skeleton width="90px" height="22px" />
      </div>
      <div className="lc-times">
        <Skeleton width="32px" height="14px" />
        <Skeleton width="32px" height="14px" />
        <Skeleton width="42px" height="14px" />
      </div>
    </div>
  )
}

export function BetSkeleton() {
  return (
    <>
      {[0, 1].map((s) => (
        <section key={s} className="bet-section">
          <Skeleton width="160px" height="20px" style={{ margin: '20px 0 12px' }} />
          <div className="card-grid">
            {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        </section>
      ))}
    </>
  )
}
