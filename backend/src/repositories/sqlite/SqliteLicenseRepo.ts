/**
 * @file repositories/sqlite/SqliteLicenseRepo.ts
 * @module repositories/sqlite
 * @description SQLite implementation ของ ILicenseRepo
 */
import type {
  ILicenseRepo,
  UserWithLicenseRow,
  CreateLicenseInput,
  UpdateLicenseFields,
} from '../interfaces/ILicenseRepo'
import type { LicenseRow, LicenseEventRow } from '../../types/index'
import db from '../../db/index'

export class SqliteLicenseRepo implements ILicenseRepo {
  async findByUserId(userId: number): Promise<LicenseRow | null> {
    return (await db.prepare('SELECT * FROM licenses WHERE user_id = ?').get<LicenseRow>(userId)) ?? null
  }

  async findById(id: number): Promise<LicenseRow | null> {
    return (await db.prepare('SELECT * FROM licenses WHERE id = ?').get<LicenseRow>(id)) ?? null
  }

  async findAllWithUsers(): Promise<UserWithLicenseRow[]> {
    return db.prepare(`
      SELECT
        u.id, u.username, u.display_name, u.role, u.active, u.is_dev, u.shop_id,
        l.id AS license_id, l.license_key, l.status, l.is_lifetime, l.expires_at, l.last_verified_at
      FROM users u
      LEFT JOIN licenses l ON l.user_id = u.id
      ORDER BY u.id ASC
    `).all<UserWithLicenseRow>()
  }

  async create(input: CreateLicenseInput): Promise<LicenseRow> {
    const result = await db.prepare(`
      INSERT INTO licenses (user_id, license_key, status, is_lifetime, expires_at, integrity_hash, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.userId,
      input.licenseKey,
      input.status,
      input.isLifetime,
      input.expiresAt,
      input.integrityHash,
      input.createdBy
    )
    return (await this.findById(Number(result.lastInsertRowid)))!
  }

  async update(id: number, fields: UpdateLicenseFields): Promise<LicenseRow> {
    const sets: string[] = []
    const values: unknown[] = []

    if (fields.status !== undefined)         { sets.push('status = ?');           values.push(fields.status) }
    if (fields.isLifetime !== undefined)     { sets.push('is_lifetime = ?');      values.push(fields.isLifetime) }
    if (fields.expiresAt !== undefined)      { sets.push('expires_at = ?');       values.push(fields.expiresAt) }
    if (fields.licenseKey !== undefined)     { sets.push('license_key = ?');      values.push(fields.licenseKey) }
    if (fields.integrityHash !== undefined)  { sets.push('integrity_hash = ?');   values.push(fields.integrityHash) }
    if (fields.lastVerifiedAt !== undefined) { sets.push('last_verified_at = ?'); values.push(fields.lastVerifiedAt) }
    sets.push("updated_at = datetime('now','localtime')")

    values.push(id)
    await db.prepare(`UPDATE licenses SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return (await this.findById(id))!
  }

  async deleteByUserId(userId: number): Promise<void> {
    await db.prepare('DELETE FROM licenses WHERE user_id = ?').run(userId)
  }

  async recordEvent(licenseId: number, actorUserId: number | null, action: string, detail?: Record<string, unknown>): Promise<void> {
    await db.prepare(`
      INSERT INTO license_events (license_id, actor_user_id, action, detail)
      VALUES (?, ?, ?, ?)
    `).run(licenseId, actorUserId, action, detail ? JSON.stringify(detail) : null)
  }

  async listEvents(licenseId: number): Promise<LicenseEventRow[]> {
    return db.prepare(
      'SELECT * FROM license_events WHERE license_id = ? ORDER BY created_at DESC'
    ).all<LicenseEventRow>(licenseId)
  }
}
