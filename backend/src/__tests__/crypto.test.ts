import { describe, it, expect, beforeAll } from 'vitest'

describe('lib/crypto — AES-256-GCM secret envelope', () => {
  let encryptSecret: typeof import('../lib/crypto').encryptSecret
  let decryptSecret: typeof import('../lib/crypto').decryptSecret

  beforeAll(async () => {
    process.env['SHOP_SECRET_KEY'] = 'a'.repeat(64)  // valid 32-byte hex for testing
    const mod = await import('../lib/crypto')
    encryptSecret = mod.encryptSecret
    decryptSecret = mod.decryptSecret
  })

  it('round-trips a plaintext string', () => {
    const plaintext = 'super-secret-line-channel-token-123'
    const encoded = encryptSecret(plaintext)
    expect(decryptSecret(encoded)).toBe(plaintext)
  })

  it('produces different ciphertext for the same plaintext each time (random IV)', () => {
    const a = encryptSecret('same-value')
    const b = encryptSecret('same-value')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same-value')
    expect(decryptSecret(b)).toBe('same-value')
  })

  it('handles Thai/unicode plaintext correctly', () => {
    const plaintext = 'ทดสอบ 測試 🎉'
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext)
  })

  it('throws on tampered ciphertext (GCM auth tag mismatch)', () => {
    const encoded = encryptSecret('original')
    const raw = Buffer.from(encoded, 'base64')
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff  // flip last byte of ciphertext
    const tampered = raw.toString('base64')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('throws when SHOP_SECRET_KEY is not valid 64-char hex', async () => {
    const original = process.env['SHOP_SECRET_KEY']
    process.env['SHOP_SECRET_KEY'] = 'too-short'
    // re-import isn't needed — getKey() reads config.shopSecretKey fresh on every call
    expect(() => encryptSecret('x')).toThrow(/64-character hex/)
    process.env['SHOP_SECRET_KEY'] = original
  })
})
