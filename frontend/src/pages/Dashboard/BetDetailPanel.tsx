/**
 * @file pages/Dashboard/BetDetailPanel.tsx
 * @module pages/Dashboard
 * @description Panel รายละเอียดโพยด้านขวาตาม UX handoff — ข้อมูลสมาชิก, รายละเอียดโพย,
 *   หลักฐานการคีย์ (note/ที่มา), ผลรางวัล + ปุ่มไปหน้าประวัติการจ่ายเงิน (/slips)
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatMoneyShort, formatDrawDate, formatDateTime, formatBetRef } from '@/lib/formatters'
import GeneratedAvatar from '@/lib/avatar'
import { type AdminBetRow, STATUS_META, SOURCE_META, splitDigits } from './types'

interface Props {
  bet:     AdminBetRow | null
  onClose: () => void
}

export default function BetDetailPanel({ bet, onClose }: Props) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  if (!bet) {
    return (
      <aside className="admdb-detail-card">
        <div className="admdb-detail-header">
          <div className="admdb-detail-title">รายละเอียดโพย</div>
        </div>
        <div className="admdb-detail-empty">คลิกที่รายการโพยในตารางเพื่อดูรายละเอียด</div>
      </aside>
    )
  }

  const meta = STATUS_META[bet.status] ?? { label: bet.status, cls: 'pending' }
  const resulted = bet.status === 'win' || bet.status === 'lose'

  return (
    <aside className="admdb-detail-card">
      <div className="admdb-detail-header">
        <div className="admdb-detail-title">รายละเอียดโพย</div>
        <div className="admdb-close-btn" onClick={onClose}>✕</div>
      </div>
      <div className="admdb-detail-body">
        <div className={`admdb-status-pill admdb-st-${meta.cls}`}>
          <span className="admdb-dot" />{meta.label}
        </div>
        <button
          className="admdb-order-ref admdb-order-ref-btn"
          title="คัดลอกเลขอ้างอิง — นำไปค้นหาต่อได้ที่หน้า โพยหวย หรือ การเงิน"
          onClick={() => {
            void navigator.clipboard.writeText(formatBetRef(bet.id))
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          เลขอ้างอิง {formatBetRef(bet.id)} {copied ? '✓ คัดลอกแล้ว' : '📋'}
        </button>

        <div className="admdb-detail-user">
          <GeneratedAvatar seed={bet.customer_name} size={44} className="admdb-detail-avatar" />
          <div>
            <div className="admdb-detail-user-name">{bet.customer_name}</div>
            <div className="admdb-detail-user-id">
              {bet.user_id ? `รหัสผู้คีย์ #${bet.user_id}` : 'ลูกค้าแทงเองผ่าน LIFF'}
            </div>
          </div>
        </div>

        <div className="admdb-info-row">
          <span className="admdb-info-label">ที่มาโพย</span>
          <span className="admdb-info-value">
            <span className={`admdb-source-chip admdb-src-${(SOURCE_META[bet.source] ?? SOURCE_META['web']!).cls}`}>
              {(SOURCE_META[bet.source] ?? SOURCE_META['web']!).label}
            </span>
          </span>
        </div>
        <div className="admdb-info-row">
          <span className="admdb-info-label">ประเภทหวย</span>
          <span className="admdb-info-value">{bet.lottery_name}</span>
        </div>
        <div className="admdb-info-row">
          <span className="admdb-info-label">งวดวันที่</span>
          <span className="admdb-info-value">{formatDrawDate(bet.draw_date)}</span>
        </div>
        <div className="admdb-info-row">
          <span className="admdb-info-label">รูปแบบการเล่น</span>
          <span className="admdb-info-value">{bet.bet_type}</span>
        </div>
        <div className="admdb-info-row">
          <span className="admdb-info-label">เลขที่คีย์</span>
          <span className="admdb-info-value">
            <span className="admdb-key-numbers">
              {splitDigits(bet.number).map((d, i) => (
                <span key={i} className={`admdb-num-box${d.length > 1 ? ' wide' : ''}`}>{d}</span>
              ))}
            </span>
          </span>
        </div>
        <div className="admdb-info-row">
          <span className="admdb-info-label">จำนวนเงิน</span>
          <span className="admdb-info-value">{formatMoneyShort(bet.amount)} บาท</span>
        </div>
        <div className="admdb-info-row">
          <span className="admdb-info-label">เรทจ่าย</span>
          <span className="admdb-info-value">x{formatMoneyShort(bet.pay_rate)}</span>
        </div>

        <div className="admdb-evidence">
          <div className="admdb-evidence-label">หลักฐานการคีย์</div>
          <div className="admdb-evidence-box">
            <div className="admdb-evidence-header">
              <div className="admdb-evidence-icon">♛</div>
              <div>
                <div className="admdb-evidence-title">คีย์เมื่อ</div>
                <div className="admdb-evidence-date">{formatDateTime(bet.created_at)}</div>
              </div>
            </div>
            {bet.note && <div className="admdb-evidence-note">{bet.note}</div>}
            <div className="admdb-evidence-total">
              <span>รวม</span>
              <span>{formatMoneyShort(bet.amount)} บาท</span>
            </div>
          </div>
        </div>

        {resulted && (
          <div className="admdb-result-section">
            <div className="admdb-result-title">ผลรางวัล</div>
            <div className="admdb-result-row">
              <span>สถานะ</span>
              <span className={bet.status === 'win' ? 'green' : 'red'}>{meta.label}</span>
            </div>
            {bet.status === 'win' && (
              <>
                <div className="admdb-result-row">
                  <span>เงินรางวัล</span>
                  <span className="green">{formatMoneyShort(bet.win_amount)} บาท</span>
                </div>
                <div className="admdb-result-row admdb-result-profit">
                  <span>จ่ายลูกค้าสุทธิ</span>
                  <span className="green">{formatMoneyShort(bet.win_amount)} บาท</span>
                </div>
              </>
            )}
            {bet.status === 'lose' && bet.discount_amount > 0 && (
              <div className="admdb-result-row">
                <span>ส่วนลดคืน</span>
                <span>{formatMoneyShort(bet.discount_amount)} บาท</span>
              </div>
            )}
          </div>
        )}

        <button className="admdb-history-btn" onClick={() => navigate('/slips')}>
          ดูประวัติการจ่ายเงิน
        </button>
      </div>
    </aside>
  )
}
