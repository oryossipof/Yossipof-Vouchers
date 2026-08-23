import type { Voucher } from '../types'

/**
 * Voucher codes are compared case-insensitively and ignoring surrounding
 * whitespace, so "abc-123", "ABC-123 " and " Abc-123" are the same coupon.
 * The database applies the same rule via lower(btrim(code)).
 */
export function normalizeCode(code: string) {
  return code.trim().toLowerCase()
}

/**
 * Finds an existing voucher holding the same code. `excludeId` skips the
 * voucher being edited, so saving it unchanged is not flagged as a duplicate.
 * An empty or whitespace-only code never matches anything.
 */
export function findVoucherByCode(
  vouchers: Voucher[],
  code: string,
  excludeId?: string
): Voucher | null {
  const normalized = normalizeCode(code)
  if (!normalized) return null
  return vouchers.find((v) => v.id !== excludeId && normalizeCode(v.code) === normalized) ?? null
}

export function duplicateMessage(existing: Voucher) {
  const status = existing.status === 'used' ? 'כבר נוצל' : 'פעיל'
  return `קוד זה כבר קיים אצלכם — שובר של ${existing.store_name} (${status}).`
}
