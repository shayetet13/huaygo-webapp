/**
 * @file pages/Society/Society.tsx
 * @page สังคมผู้แพ้ (/society)
 * @module pages/Society
 * @description แหล่งข้อมูลผลหวย 4 tabs — ธง/ไอคอนดึงจาก /api/markets เหมือนหน้าแรก
 */
import { useState, useEffect } from 'react'
import { SOCIETY_TABS } from '@/lib/constants'
import type { LotteryCategory } from '@/types'
import './Society.css'

/* ── Types ───────────────────────────────────────────────────── */
interface SourceItem {
  id:          number
  name:        string      // ตรงกับ marketTitle ใน API
  flagCode:    string      // CSS fallback: 'th' | 'vn' | 'laos' | 'jp' | ...
  closeTime:   string
  resultTime:  string
  sourceUrl?:  string      // https:// URL
  sourceName?: string      // label ธรรมดา (ไม่มี URL)
}

/* ── Data ────────────────────────────────────────────────────── */
const THAI_SOURCES: SourceItem[] = [
  { id: 1, name: 'หวยรัฐบาล', flagCode: 'th', closeTime: '15:20 น.', resultTime: '15:30 น.', sourceUrl: 'https://www.glo.or.th' },
  { id: 2, name: 'หวยออมสิน', flagCode: 'th', closeTime: '10:40 น.', resultTime: '11:00 น.', sourceUrl: 'https://www.gsb.or.th' },
  { id: 3, name: 'หวย ธกส.',  flagCode: 'th', closeTime: '10:20 น.', resultTime: '12:00 น.', sourceUrl: 'https://www.baac.or.th' },
]

const FOREIGN_SOURCES: SourceItem[] = [
  { id: 1,  name: 'ฮานอยพิเศษ',   flagCode: 'vn',   closeTime: '17:10 น.', resultTime: '17:30 น.', sourceUrl: 'https://www.xsthm.com' },
  { id: 2,  name: 'ฮานอยปกติ',    flagCode: 'vn',   closeTime: '18:10 น.', resultTime: '18:30 น.', sourceUrl: 'https://www.minhngoc.net.vn' },
  { id: 3,  name: 'หวยมาเลเซีย',  flagCode: 'mal',  closeTime: '18:05 น.', resultTime: '18:30 น.', sourceUrl: 'https://www.magnum4d.my' },
  { id: 4,  name: 'ฮานอย ตรุษจีน', flagCode: 'vn',   closeTime: '18:10 น.', resultTime: '18:30 น.', sourceName: 'ฮานอยตรุษจีน' },
  { id: 5,  name: 'ฮานอย VIP',    flagCode: 'vn',   closeTime: '19:10 น.', resultTime: '19:30 น.', sourceUrl: 'https://www.mlnhngoc.net' },
  { id: 6,  name: 'ลาวพัฒนา',     flagCode: 'laos', closeTime: '20:20 น.', resultTime: '20:30 น.', sourceName: 'ลาวพัฒนา' },
  { id: 7,  name: 'ลาว VIP',      flagCode: 'laos', closeTime: '21:20 น.', resultTime: '21:30 น.', sourceUrl: 'https://www.laosviplot.com' },
]

const DAILY_SOURCES: SourceItem[] = [
  { id: 1,  name: 'ลาวประตูชัย',    flagCode: 'laos', closeTime: '05:40 น.', resultTime: '05:45 น.', sourceUrl: 'https://laopatuxay.com' },
  { id: 2,  name: 'ลาวสันติภาพ',    flagCode: 'laos', closeTime: '06:40 น.', resultTime: '06:45 น.', sourceUrl: 'https://laosantipap.com' },
  { id: 3,  name: 'ประชาชนลาว',     flagCode: 'laos', closeTime: '07:40 น.', resultTime: '07:45 น.', sourceUrl: 'https://laocitizen.com' },
  { id: 4,  name: 'ลาว Extra',      flagCode: 'laos', closeTime: '08:25 น.', resultTime: '08:30 น.', sourceUrl: 'https://laoextra.com' },
  { id: 5,  name: 'นิเคอิเช้า VIP', flagCode: 'jp',   closeTime: '09:00 น.', resultTime: '09:05 น.', sourceName: 'Nikkei VIP' },
  { id: 6,  name: 'ฮานอยอาเซียน',  flagCode: 'vn',   closeTime: '09:10 น.', resultTime: '09:30 น.', sourceUrl: 'https://hanoiasean.com' },
  { id: 7,  name: 'จีนเช้า VIP',    flagCode: 'cn',   closeTime: '10:00 น.', resultTime: '10:05 น.', sourceUrl: 'https://shenzhenindex.com' },
  { id: 8,  name: 'ลาว TV',         flagCode: 'laos', closeTime: '10:25 น.', resultTime: '10:30 น.', sourceUrl: 'https://lao-tv.com' },
  { id: 9,  name: 'ฮั่งเส็งเช้า VIP', flagCode: 'hk', closeTime: '10:30 น.', resultTime: '10:35 น.', sourceUrl: 'https://hangsengvip.com' },
  { id: 10, name: 'ฮานอย HD',       flagCode: 'vn',   closeTime: '11:10 น.', resultTime: '11:30 น.', sourceUrl: 'https://xosohd.com' },
  { id: 11, name: 'ไต้หวัน VIP',    flagCode: 'tw',   closeTime: '11:30 น.', resultTime: '11:35 น.', sourceUrl: 'https://tsecvipindex.com' },
  { id: 12, name: 'ฮานอย สตาร์',   flagCode: 'vn',   closeTime: '12:10 น.', resultTime: '12:30 น.', sourceUrl: 'https://minhngocstar.com' },
  { id: 13, name: 'เกาหลี VIP',     flagCode: 'kr',   closeTime: '12:30 น.', resultTime: '12:35 น.', sourceUrl: 'https://ktopvipindex.com' },
  { id: 14, name: 'นิเคอิบ่าย VIP', flagCode: 'jp',   closeTime: '13:20 น.', resultTime: '13:25 น.', sourceUrl: 'https://nikkeivipstock.com' },
  { id: 15, name: 'ลาว HD',         flagCode: 'laos', closeTime: '13:40 น.', resultTime: '13:45 น.', sourceUrl: 'https://laoshd.com' },
  { id: 16, name: 'ฮานอย TV',       flagCode: 'vn',   closeTime: '14:10 น.', resultTime: '14:30 น.', sourceUrl: 'https://minhngoctv.com' },
  { id: 17, name: 'จีนบ่าย VIP',    flagCode: 'cn',   closeTime: '14:20 น.', resultTime: '14:25 น.', sourceUrl: 'https://shenzhenindex.com' },
  { id: 18, name: 'ฮั่งเส็งบ่าย VIP', flagCode: 'hk', closeTime: '15:20 น.', resultTime: '15:25 น.', sourceUrl: 'https://hangsengvip.com' },
  { id: 19, name: 'ลาวสตาร์',       flagCode: 'laos', closeTime: '15:40 น.', resultTime: '15:45 น.', sourceUrl: 'https://www.laostars.com' },
  { id: 20, name: 'ฮานอยกาชาด',    flagCode: 'vn',   closeTime: '16:10 น.', resultTime: '16:30 น.', sourceUrl: 'https://xosoredcross.com' },
  { id: 21, name: 'สิงคโปร์ VIP',   flagCode: 'sg',   closeTime: '17:00 น.', resultTime: '17:05 น.', sourceUrl: 'https://stocks-vip.com' },
  { id: 22, name: 'ฮานอยสามัคคี',  flagCode: 'vn',   closeTime: '17:10 น.', resultTime: '17:30 น.', sourceUrl: 'https://xosounion.com' },
  { id: 23, name: 'ฮานอยพัฒนา',    flagCode: 'vn',   closeTime: '19:10 น.', resultTime: '19:30 น.', sourceUrl: 'https://xosodevelop.com' },
  { id: 24, name: 'ลาวใต้',         flagCode: 'laos', closeTime: '19:45 น.', resultTime: '20:00 น.', sourceName: 'ผลหวยลาวใต้' },
  { id: 25, name: 'ลาวสามัคคี',     flagCode: 'laos', closeTime: '20:20 น.', resultTime: '20:30 น.', sourceUrl: 'https://laounion.com' },
  { id: 26, name: 'ลาวอาเซียน',     flagCode: 'laos', closeTime: '20:55 น.', resultTime: '21:00 น.', sourceUrl: 'https://lotterylaosasean.com' },
  { id: 27, name: 'ลาวสามัคคี VIP', flagCode: 'laos', closeTime: '21:25 น.', resultTime: '21:30 น.', sourceUrl: 'https://laounionvip.com' },
  { id: 28, name: 'ลาวสตาร์ VIP',   flagCode: 'laos', closeTime: '21:45 น.', resultTime: '22:00 น.', sourceUrl: 'https://www.laostars-vip.com' },
  { id: 29, name: 'อังกฤษ VIP',     flagCode: 'uk',   closeTime: '21:45 น.', resultTime: '21:50 น.', sourceUrl: 'https://lottosuperrich.com' },
  { id: 30, name: 'ฮานอย Extra',    flagCode: 'vn',   closeTime: '22:10 น.', resultTime: '22:30 น.', sourceUrl: 'https://xosoextra.com' },
  { id: 31, name: 'เยอรมัน VIP',    flagCode: 'de',   closeTime: '22:45 น.', resultTime: '22:50 น.', sourceUrl: 'https://lottosuperrich.com' },
  { id: 32, name: 'ลาวกาชาด',       flagCode: 'laos', closeTime: '23:25 น.', resultTime: '23:30 น.', sourceUrl: 'https://lao-redcross.com' },
  { id: 33, name: 'รัสเซีย VIP',    flagCode: 'ru',   closeTime: '23:45 น.', resultTime: '23:50 น.', sourceUrl: 'https://lottosuperrich.com' },
  { id: 34, name: 'ดาวโจนส์ VIP',   flagCode: 'us',   closeTime: '00:10 น.', resultTime: '00:30 น.', sourceUrl: 'https://dowjonespowerball.com' },
  { id: 35, name: 'ดาวโจนส์ STAR',  flagCode: 'us',   closeTime: '01:05 น.', resultTime: '01:15 น.', sourceUrl: 'https://dowjonestar.com' },
  { id: 36, name: 'ดาวโจนส์ mid night', flagCode: 'us', closeTime: '02:35 น.', resultTime: '02:50 น.', sourceName: 'ดาวโจนส์ mid night' },
  { id: 37, name: 'ดาวโจนส์ extra', flagCode: 'us',   closeTime: '03:35 น.', resultTime: '03:50 น.', sourceName: 'ดาวโจนส์ extra' },
  { id: 38, name: 'ดาวโจนส์ TV',    flagCode: 'us',   closeTime: '04:35 น.', resultTime: '04:45 น.', sourceUrl: 'https://tvdowjones.com' },
]

const STOCK_SOURCES: SourceItem[] = [
  { id: 1,  name: 'นิเคอิ - เช้า',  flagCode: 'jp',  closeTime: '09:25 น.', resultTime: '09:30 น.', sourceUrl: 'https://nikkei.co.jp' },
  { id: 2,  name: 'หุ้นจีน - เช้า', flagCode: 'cn',  closeTime: '10:20 น.', resultTime: '10:30 น.', sourceUrl: 'https://www.szse.cn' },
  { id: 3,  name: 'ฮั่งเส็ง - เช้า', flagCode: 'hk', closeTime: '10:55 น.', resultTime: '11:00 น.', sourceUrl: 'https://www.hsi.com.hk' },
  { id: 4,  name: 'หุ้นไต้หวัน',    flagCode: 'tw',  closeTime: '12:10 น.', resultTime: '12:30 น.', sourceUrl: 'https://www.twse.com.tw' },
  { id: 5,  name: 'หุ้นเกาหลี',     flagCode: 'kr',  closeTime: '12:45 น.', resultTime: '13:30 น.', sourceUrl: 'https://global.krx.co.kr' },
  { id: 6,  name: 'นิเคอิ - บ่าย',  flagCode: 'jp',  closeTime: '12:55 น.', resultTime: '13:00 น.', sourceUrl: 'https://nikkei.co.jp' },
  { id: 7,  name: 'หุ้นจีน - บ่าย', flagCode: 'cn',  closeTime: '13:45 น.', resultTime: '14:00 น.', sourceUrl: 'https://www.szse.cn' },
  { id: 8,  name: 'ฮั่งเส็ง - บ่าย', flagCode: 'hk', closeTime: '14:55 น.', resultTime: '15:15 น.', sourceUrl: 'https://www.hsi.com.hk' },
  { id: 9,  name: 'หุ้นสิงคโปร์',   flagCode: 'sg',  closeTime: '15:55 น.', resultTime: '16:30 น.', sourceUrl: 'https://www.sgx.com' },
  { id: 10, name: 'หุ้นไทย - เย็น', flagCode: 'th',  closeTime: '16:05 น.', resultTime: '16:45 น.', sourceUrl: 'https://marketdata.set.or.th' },
  { id: 11, name: 'หุ้นอินเดีย',    flagCode: 'in',  closeTime: '16:50 น.', resultTime: '17:40 น.', sourceUrl: 'https://www.bseindia.com' },
  { id: 12, name: 'หุ้นอียิปต์',    flagCode: 'eg',  closeTime: '17:10 น.', resultTime: '20:00 น.', sourceUrl: 'https://www.investing.com' },
  { id: 13, name: 'หุ้นอังกฤษ',     flagCode: 'uk',  closeTime: '22:15 น.', resultTime: '23:35 น.', sourceUrl: 'https://www.bloomberg.com' },
  { id: 14, name: 'หุ้นเยอรมัน',    flagCode: 'de',  closeTime: '22:15 น.', resultTime: '23:40 น.', sourceUrl: 'https://www.marketwatch.com' },
  { id: 15, name: 'หุ้นรัสเซีย',    flagCode: 'ru',  closeTime: '22:30 น.', resultTime: '22:50 น.', sourceUrl: 'https://www.investing.com' },
  { id: 16, name: 'หุ้นดาวโจนส์',   flagCode: 'us',  closeTime: '02:00 น.', resultTime: '04:00 น.', sourceUrl: 'https://www.marketwatch.com' },
]

/* ── Icon: ดึง imageIcon จาก API เหมือนหน้าแรก ─────────────────── */
function FlagIcon({ name, flagCode, compact, iconMap }: {
  name:    string
  flagCode: string
  compact?: boolean
  iconMap: Map<string, string>
}) {
  const url = iconMap.get(name)
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`source-icon-img${compact ? ' compact' : ''}`}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  const size = compact ? 'flag-xl' : 'flag-lg'
  return <div className={`flag ${size} flag-${flagCode}`} />
}

/* ── Source rows renderer ────────────────────────────────────── */
function SourceRows({ item, compact }: { item: SourceItem; compact?: boolean }) {
  const linkEl = item.sourceUrl ? (
    <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
      {item.sourceName ?? item.sourceUrl.replace(/^https?:\/\//, '')}
    </a>
  ) : item.sourceName ? (
    <span style={{ color: '#64748b', fontSize: 13 }}>{item.sourceName}</span>
  ) : null

  if (compact) {
    return (
      <div className="compact-row">
        <span className="compact-cell">
          <span className="icon close">✕</span>
          {item.closeTime}
        </span>
        <span className="compact-cell">
          <span className="icon check">✓</span>
          {item.resultTime}
        </span>
        {linkEl && (
          <span className="compact-cell">
            <span className="icon link">↗</span>
            {linkEl}
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="source-row">
        <span className="icon close">✕</span>
        <span>ปิดรับ: {item.closeTime}</span>
      </div>
      <div className="source-row">
        <span className="icon check">✓</span>
        <span>ผลออก: {item.resultTime}</span>
      </div>
      {linkEl && (
        <div className="source-row">
          <span className="icon link">↗</span>
          {linkEl}
        </div>
      )}
    </>
  )
}

/* ── Page component ──────────────────────────────────────────── */
export default function Society() {
  const [tab,     setTab]     = useState<LotteryCategory>('หวยไทย')
  const [iconMap, setIconMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    fetch('/api/markets')
      .then((r) => r.json())
      .then((json: { data?: { marketTitle?: string; imageIcon?: string | null }[] }) => {
        const m = new Map<string, string>()
        for (const item of json.data ?? []) {
          if (item.marketTitle && item.imageIcon) m.set(item.marketTitle, item.imageIcon)
        }
        setIconMap(m)
      })
      .catch(() => { /* ใช้ CSS flag fallback */ })
  }, [])

  return (
    <main className="page-society">
      <div className="container">
        <h1 className="page-title">link ดูผลรางวัล</h1>

        <div className="content-tabs">
          {SOCIETY_TABS.map((t) => (
            <button
              key={t}
              className={`content-tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'หวยชุดนาน' ? 'หวยรายวัน' : t}
            </button>
          ))}
        </div>

        {tab === 'หวยไทย' && (
          <div className="content-panel">
            {THAI_SOURCES.map((item) => (
              <div key={item.id} className="source-item">
                <FlagIcon name={item.name} flagCode={item.flagCode} iconMap={iconMap} />
                <div className="source-info">
                  <div className="source-name">{item.name}</div>
                  <SourceRows item={item} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'หวยต่างประเทศ' && (
          <div className="content-panel">
            {FOREIGN_SOURCES.map((item) => (
              <div key={item.id} className="source-item">
                <FlagIcon name={item.name} flagCode={item.flagCode} iconMap={iconMap} />
                <div className="source-info">
                  <div className="source-name">{item.name}</div>
                  <SourceRows item={item} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'หวยชุดนาน' && (
          <div className="content-panel compact">
            {DAILY_SOURCES.map((item) => (
              <div key={item.id} className="source-item compact">
                <FlagIcon name={item.name} flagCode={item.flagCode} compact iconMap={iconMap} />
                <div className="source-info">
                  <div className="source-name compact">{item.name}</div>
                  <SourceRows item={item} compact />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'หวยหุ้น' && (
          <div className="content-panel">
            {STOCK_SOURCES.map((item) => (
              <div key={item.id} className="source-item">
                <FlagIcon name={item.name} flagCode={item.flagCode} iconMap={iconMap} />
                <div className="source-info">
                  <div className="source-name">{item.name}</div>
                  <SourceRows item={item} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
