import { describe, expect, it } from 'vitest'
import type { Voucher } from '../types'
import { duplicateMessage, findVoucherByCode, normalizeCode } from './vouchers'

function voucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    user_id: 'u1',
    store_name: 'Test Store',
    code: 'ABC-123',
    amount: null,
    note: null,
    photo_path: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    used_at: null,
    expires_at: null,
    ...overrides,
  }
}

describe('normalizeCode', () => {
  it('lowercases and trims', () => {
    expect(normalizeCode('  ABC-123 ')).toBe('abc-123')
  })

  it('collapses an all-whitespace code to empty', () => {
    expect(normalizeCode('   ')).toBe('')
  })
})

describe('findVoucherByCode', () => {
  const existing = [voucher({ id: 'v1', code: 'ABC-123' }), voucher({ id: 'v2', code: 'XYZ-999' })]

  it('finds an exact match', () => {
    expect(findVoucherByCode(existing, 'XYZ-999')?.id).toBe('v2')
  })

  it('matches regardless of case and surrounding whitespace', () => {
    expect(findVoucherByCode(existing, '  abc-123  ')?.id).toBe('v1')
  })

  it('returns null when no voucher holds the code', () => {
    expect(findVoucherByCode(existing, 'NOT-HERE')).toBeNull()
  })

  it('never matches on an empty or whitespace-only code', () => {
    expect(findVoucherByCode(existing, '')).toBeNull()
    expect(findVoucherByCode(existing, '   ')).toBeNull()
  })

  it('excludes the voucher being edited, so saving it unchanged is allowed', () => {
    expect(findVoucherByCode(existing, 'ABC-123', 'v1')).toBeNull()
  })

  it('still flags a collision with a different voucher while editing', () => {
    expect(findVoucherByCode(existing, 'XYZ-999', 'v1')?.id).toBe('v2')
  })

  it('finds used vouchers too, not just active ones', () => {
    const used = [voucher({ id: 'v3', code: 'OLD-1', status: 'used' })]
    expect(findVoucherByCode(used, 'old-1')?.id).toBe('v3')
  })
})

describe('duplicateMessage', () => {
  it('reports an active voucher as active', () => {
    expect(duplicateMessage(voucher({ store_name: 'איקאה' }))).toContain('פעיל')
  })

  it('reports a used voucher as already used', () => {
    expect(duplicateMessage(voucher({ status: 'used' }))).toContain('כבר נוצל')
  })

  it('names the store holding the duplicate', () => {
    expect(duplicateMessage(voucher({ store_name: 'קפה קפה' }))).toContain('קפה קפה')
  })
})
