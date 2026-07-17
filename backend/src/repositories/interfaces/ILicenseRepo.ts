/**
 * @file repositories/interfaces/ILicenseRepo.ts
 * @module repositories/interfaces
 * @description Repository interface สำหรับ licenses + license_events
 */
import type { LicenseRow, LicenseEventRow } from '../../types/index'

export interface UserWithLicenseRow {
  id:               number
  username:         string
  display_name:     string
  role:             string
  active:           number
  is_dev:           number
  shop_id:          number | null
  license_id:       number | null
  license_key:      string | null
  status:           'active' | 'suspended' | 'expired' | null
  is_lifetime:       number | null
  expires_at:       string | null
  last_verified_at: string | null
}

export interface CreateLicenseInput {
  userId:      number
  licenseKey:  string
  status:      'active' | 'suspended'
  isLifetime:  number
  expiresAt:   string | null
  integrityHash: string
  createdBy:   number | null
}

export interface UpdateLicenseFields {
  status?:        'active' | 'suspended' | 'expired'
  isLifetime?:    number
  expiresAt?:     string | null
  licenseKey?:    string
  integrityHash?: string
  lastVerifiedAt?: string
}

export interface ILicenseRepo {
  findByUserId(userId: number): Promise<LicenseRow | null>
  findById(id: number): Promise<LicenseRow | null>
  findAllWithUsers(): Promise<UserWithLicenseRow[]>
  create(input: CreateLicenseInput): Promise<LicenseRow>
  update(id: number, fields: UpdateLicenseFields): Promise<LicenseRow>
  deleteByUserId(userId: number): Promise<void>
  recordEvent(licenseId: number, actorUserId: number | null, action: string, detail?: Record<string, unknown>): Promise<void>
  listEvents(licenseId: number): Promise<LicenseEventRow[]>
}
