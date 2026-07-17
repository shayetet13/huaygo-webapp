/**
 * @file liff/components/HistorySheet.tsx
 * @module liff/components
 * @description ผลย้อนหลัง 5 งวดของตลาดที่กำลังแทง — เทียบเท่า HistoryPanel ฝั่ง desktop (BetForm.tsx)
 */
import BottomSheet from './BottomSheet'

export interface HistoryRow {
  draw_date:   string
  result_3top: string | null
  result_2top: string | null
  result_2bot: string | null
  market_title: string
}

function fmtDateHist(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

export default function HistorySheet({ history, onClose }: { history: HistoryRow[]; onClose: () => void }) {
  return (
    <BottomSheet title="ผลย้อนหลัง" onClose={onClose}>
      {history.length === 0 ? (
        <div className="sheet-empty">ยังไม่มีข้อมูลผลย้อนหลัง</div>
      ) : (
        <div className="hist-list">
          <div className="hist-list-hd">
            <span>งวดวันที่</span><span>3 ตัวบน</span><span>2 ตัวล่าง</span>
          </div>
          {history.map((h, i) => (
            <div className="hist-row" key={i}>
              <span className="hist-date">{fmtDateHist(h.draw_date)}</span>
              <span className="hist-num">{h.result_3top ?? '—'}</span>
              <span className="hist-num">{h.result_2bot ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
