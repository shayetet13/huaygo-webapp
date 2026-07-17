/**
 * @file Footer/Footer.tsx
 * @module components/Footer
 * @description Footer — แปลงจาก .footer ใน html demo ทุกไฟล์
 */
import './Footer.css'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="footer">
      ©{year} - หวย
    </footer>
  )
}
