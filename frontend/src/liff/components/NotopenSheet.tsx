/**
 * @file liff/components/NotopenSheet.tsx
 * @module liff/components
 * @description แตะตลาดที่ "ยังไม่เปิด" ในหน้า 2 (เลือกหวยที่จะเล่น) — เทียบเท่า NotopenModal
 *   ฝั่ง desktop (pages/Bet/Bet.tsx) นับถอยหลังสดถึงเวลาเปิดรับ
 */
import type { MarketWithState } from '@/hooks/useMarkets'
import { useTick, computeCountdown } from '../lib/countdown'
import { GroupIconTicket } from '../lib/icons'
import BottomSheet from './BottomSheet'

export default function NotopenSheet({ market, onClose }: { market: MarketWithState; onClose: () => void }) {
  useTick()
  const cd       = computeCountdown(market.openTime, market.closeTime)
  const openHHMM = market.openTime.split(' ')[1]?.slice(0, 5) ?? '—'

  return (
    <BottomSheet title="ยังไม่เปิดรับการเดิมพัน" onClose={onClose}>
      <div className="notopen-body">
        {market.imageIcon
          ? <img src={market.imageIcon} alt={market.marketTitle} className="notopen-img" />
          : <span className="big-ic"><GroupIconTicket /></span>}
        <div className="notopen-name">{market.marketTitle}</div>
        <div className="notopen-cd">{cd.display}</div>
        <div className="notopen-sub">เปิดรับเวลา {openHHMM} น.</div>
        <button className="btn-primary" onClick={onClose}>รับทราบ</button>
      </div>
    </BottomSheet>
  )
}
