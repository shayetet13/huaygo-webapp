/**
 * @file lib/avatar.tsx
 * @module lib
 * @description Avatar แบบ "รูปโปรไฟล์คน" generative — วาดหน้าคนจริงจาก layer ง่ายๆ (พื้นหลัง/ทรงผม/
 *  สีผิว/เสื้อ) ผสมกันตาม hash ของชื่อแบบ deterministic (ชื่อเดิมได้หน้าเดิมเสมอ, คนละชื่อแทบไม่ซ้ำกัน)
 *  ไม่พึ่ง asset/บริการภายนอกใดๆ จึงโหลดเร็วและไม่รั่วชื่อลูกค้าออกไปยัง third-party avatar service
 */

function hashSeed(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h
}

/** ดึงตัวเลข deterministic ตัวถัดไปจาก hash เดิม — หมุน bit แทน PRNG เต็มรูปแบบ เพราะแค่ต้องการ
 * ดัชนีเลือก palette/สไตล์ไม่กี่ตัว ไม่ได้ต้องการการกระจายสุ่มคุณภาพสูงแบบ mulberry32 */
function nextIndex(seed: number, salt: number, mod: number): number {
  const mixed = (Math.imul(seed ^ salt, 2654435761) >>> 0)
  return mixed % mod
}

const BG_COLORS    = ['#FFD6A5', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF', '#FDE68A', '#BAE6FD']
const SKIN_TONES    = ['#FFE0BD', '#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#4A2C13']
const HAIR_COLORS   = ['#0B0B0B', '#3B2314', '#6A4E23', '#A56A3A', '#D4A017', '#6B6B6B']
const CLOTHES_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16']

interface FaceSpec {
  bg: string
  skin: string
  hair: string
  clothes: string
  hairStyle: number // 0..4
}

function buildFace(seed: string): FaceSpec {
  const h = hashSeed(seed || '?')
  return {
    bg: BG_COLORS[nextIndex(h, 1, BG_COLORS.length)]!,
    skin: SKIN_TONES[nextIndex(h, 2, SKIN_TONES.length)]!,
    hair: HAIR_COLORS[nextIndex(h, 3, HAIR_COLORS.length)]!,
    clothes: CLOTHES_COLORS[nextIndex(h, 4, CLOTHES_COLORS.length)]!,
    hairStyle: nextIndex(h, 5, 5),
  }
}

/** ทรงผม 5 แบบ — วาดเป็น ellipse หลังหัวแล้วปรับตำแหน่ง/ขนาดให้ silhouette ต่างกันชัดเจน
 * (เสี้ยนสูง/หน้าม้าเยื้อง/มวยผม/ผมสั้นเห็นหน้าผาก/หัวล้าน) */
function Hair({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 0: // ผมทรงกลมปกติ
      return <ellipse cx="40" cy="25" rx="18" ry="16" fill={color} />
    case 1: // แสกข้าง เยื้องซ้าย
      return <ellipse cx="36" cy="24" rx="19" ry="17" fill={color} transform="rotate(-8 36 24)" />
    case 2: // มวยผมด้านบน
      return (
        <>
          <ellipse cx="40" cy="27" rx="17" ry="15" fill={color} />
          <circle cx="40" cy="10" r="6" fill={color} />
        </>
      )
    case 3: // ผมสั้น เห็นหน้าผากเยอะ
      return <ellipse cx="40" cy="19" rx="17" ry="10" fill={color} />
    default: // หัวล้าน — ไม่มีผม
      return null
  }
}

interface Props {
  /** ตัวระบุที่ใช้ generate avatar — ต้องคงที่ต่อคนเดิมเสมอ (ใช้ customer_name ตาม convention เดิม) */
  seed: string
  size?: number
  className?: string
}

export default function GeneratedAvatar({ seed, size = 36, className }: Props) {
  const safeSeed = seed || '?'
  const face = buildFace(safeSeed)
  const clipId = `av-clip-${hashSeed(safeSeed)}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={className}
      role="img"
      aria-label={safeSeed}
      style={{ borderRadius: '50%', flexShrink: 0 }}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="40" cy="40" r="40" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="80" height="80" fill={face.bg} />
        {/* ไหล่/เสื้อ */}
        <path d="M 6 80 Q 6 52 40 52 Q 74 52 74 80 Z" fill={face.clothes} />
        {/* ผม (วาดก่อนหัว ให้โผล่ขอบรอบศีรษะ) */}
        <Hair style={face.hairStyle} color={face.hair} />
        {/* ศีรษะ */}
        <circle cx="40" cy="36" r="15" fill={face.skin} />
        {/* ตา */}
        <circle cx="34" cy="35" r="1.8" fill="#2b2b2b" />
        <circle cx="46" cy="35" r="1.8" fill="#2b2b2b" />
        {/* ปาก */}
        <path d="M 34 43 Q 40 47 46 43" stroke="#8a4a3a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  )
}
