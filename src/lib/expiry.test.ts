import { describe, expect, it } from 'vitest'
import type { Voucher } from '../types'
import {
  compareByExpiry,
  daysUntilExpiry,
  expiryLabel,
  expiryTone,
  formatDate,
  isExpired,
  isIsoDate,
  maskDateInput,
  parseDate,
  todayInIsrael,
} from './expiry'

function voucher(expires_at: string | null, created_at = '2026-01-01T00:00:00Z', id = 'v1'): Voucher {
  return {
    id,
    user_id: 'u1',
    store_name: 'קסטרו',
    code: 'ABC-123',
    amount: null,
    note: null,
    photo_path: null,
    status: 'active',
    created_at,
    used_at: null,
    expires_at,
  }
}

/** Sorts a list the way the app does and returns the ids, for readability. */
function order(list: Voucher[], newestFirst = false): string[] {
  return [...list].sort((a, b) => compareByExpiry(a, b, newestFirst)).map((v) => v.id)
}

describe('isIsoDate', () => {
  it('accepts a real day', () => {
    expect(isIsoDate('2026-11-30')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
  })

  it('rejects days that do not exist', () => {
    expect(isIsoDate('2026-02-31')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('2026-11-31')).toBe(false)
    // 2026 is not a leap year.
    expect(isIsoDate('2026-02-29')).toBe(false)
  })

  it('rejects anything not in the ISO shape', () => {
    expect(isIsoDate('30/11/2026')).toBe(false)
    expect(isIsoDate('2026-1-1')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})

describe('formatDate', () => {
  it('renders dd/mm/yyyy', () => {
    expect(formatDate('2026-11-30')).toBe('30/11/2026')
    expect(formatDate('2026-01-05')).toBe('05/01/2026')
  })

  it('returns an empty string rather than throwing on bad input', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('nonsense')).toBe('')
    expect(formatDate('2026-02-31')).toBe('')
  })
})

describe('parseDate', () => {
  it('reads dd/mm/yyyy', () => {
    expect(parseDate('30/11/2026')).toBe('2026-11-30')
  })

  it('accepts single-digit day and month, which is natural to type', () => {
    expect(parseDate('5/3/2026')).toBe('2026-03-05')
  })

  it('ignores surrounding whitespace', () => {
    expect(parseDate('  30/11/2026 ')).toBe('2026-11-30')
  })

  it('reads day first, never month first', () => {
    // 03/04 is 3 April, not 4 March. Getting this backwards would silently
    // shift most dates by weeks.
    expect(parseDate('03/04/2026')).toBe('2026-04-03')
  })

  it('rejects impossible and malformed dates', () => {
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('30/13/2026')).toBeNull()
    expect(parseDate('2026-11-30')).toBeNull()
    expect(parseDate('30/11/26')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
})

describe('maskDateInput', () => {
  it('inserts the slashes while typing', () => {
    expect(maskDateInput('3')).toBe('3')
    expect(maskDateInput('30')).toBe('30')
    expect(maskDateInput('301')).toBe('30/1')
    expect(maskDateInput('30112026')).toBe('30/11/2026')
  })

  it('leaves an already-formatted value alone', () => {
    expect(maskDateInput('30/11/2026')).toBe('30/11/2026')
  })

  it('drops non-digits and anything past eight digits', () => {
    expect(maskDateInput('30-11-2026')).toBe('30/11/2026')
    expect(maskDateInput('301120261234')).toBe('30/11/2026')
  })

  it('shrinks as the user deletes', () => {
    // Backspacing '30/11/2026' to '30/11/202' must not re-add a trailing slash.
    expect(maskDateInput('30/11/202')).toBe('30/11/202')
    expect(maskDateInput('30/1')).toBe('30/1')
    expect(maskDateInput('')).toBe('')
  })
})

describe('daysUntilExpiry', () => {
  const today = '2026-11-23'

  it('counts forward to the expiry day', () => {
    expect(daysUntilExpiry(voucher('2026-11-30'), today)).toBe(7)
    expect(daysUntilExpiry(voucher('2026-11-24'), today)).toBe(1)
    expect(daysUntilExpiry(voucher('2026-11-23'), today)).toBe(0)
  })

  it('goes negative once the day has passed', () => {
    expect(daysUntilExpiry(voucher('2026-11-22'), today)).toBe(-1)
  })

  it('is null when there is no expiry date', () => {
    expect(daysUntilExpiry(voucher(null), today)).toBeNull()
  })

  it('crosses month and year boundaries', () => {
    expect(daysUntilExpiry(voucher('2026-12-01'), '2026-11-30')).toBe(1)
    expect(daysUntilExpiry(voucher('2027-01-01'), '2026-12-31')).toBe(1)
  })

  it('is unaffected by daylight saving, which is why the maths is in UTC', () => {
    // Israel moves the clock on the last Friday of March. A local-time
    // subtraction across it yields 0.958 days and rounds wrong.
    expect(daysUntilExpiry(voucher('2026-03-30'), '2026-03-29')).toBe(1)
    expect(daysUntilExpiry(voucher('2026-04-05'), '2026-03-29')).toBe(7)
  })
})

describe('isExpired', () => {
  it('is still usable on the expiry day itself', () => {
    expect(isExpired(voucher('2026-11-23'), '2026-11-23')).toBe(false)
  })

  it('is expired the day after', () => {
    expect(isExpired(voucher('2026-11-23'), '2026-11-24')).toBe(true)
  })

  it('never expires without a date', () => {
    expect(isExpired(voucher(null), '2099-01-01')).toBe(false)
  })
})

describe('expiryTone', () => {
  const today = '2026-11-23'

  it('flags the last week', () => {
    expect(expiryTone(voucher('2026-11-30'), today)).toBe('soon')
    expect(expiryTone(voucher('2026-11-23'), today)).toBe('soon')
  })

  it('stays quiet further out', () => {
    expect(expiryTone(voucher('2026-12-01'), today)).toBe('later')
  })

  it('reports an expired voucher', () => {
    expect(expiryTone(voucher('2026-11-01'), today)).toBe('expired')
  })

  it('has nothing to say without a date', () => {
    expect(expiryTone(voucher(null), today)).toBeNull()
  })
})

describe('expiryLabel', () => {
  const today = '2026-11-23'

  it('names the day for the urgent cases', () => {
    expect(expiryLabel(voucher('2026-11-23'), today)).toBe('פג תוקף היום')
    expect(expiryLabel(voucher('2026-11-24'), today)).toBe('פג תוקף מחר')
    expect(expiryLabel(voucher('2026-11-26'), today)).toBe('פג תוקף בעוד 3 ימים')
  })

  it('gives the date once it is far enough out', () => {
    expect(expiryLabel(voucher('2026-12-25'), today)).toBe('בתוקף עד 25/12/2026')
  })

  it('gives the date it lapsed on once past', () => {
    expect(expiryLabel(voucher('2026-11-01'), today)).toBe('פג תוקף ב-01/11/2026')
  })

  it('is null without a date', () => {
    expect(expiryLabel(voucher(null), today)).toBeNull()
  })
})

describe('todayInIsrael', () => {
  it('returns an ISO date', () => {
    expect(isIsoDate(todayInIsrael())).toBe(true)
  })

  it('uses the Israeli civil day, not UTC', () => {
    // Israel is UTC+2 in November, so 22:30 UTC on the 22nd is already
    // 00:30 on the 23rd there.
    expect(todayInIsrael(new Date('2026-11-22T22:30:00Z'))).toBe('2026-11-23')
    // ...while the same instant is still the 22nd in UTC terms. Reading the
    // date off a UTC timestamp would put the reminder out a day early.
    expect(new Date('2026-11-22T22:30:00Z').toISOString().slice(0, 10)).toBe('2026-11-22')
    // An hour earlier it is still the 22nd in Israel too.
    expect(todayInIsrael(new Date('2026-11-22T21:30:00Z'))).toBe('2026-11-22')
  })
})

describe('compareByExpiry', () => {
  it('puts whatever lapses soonest first', () => {
    const soon = voucher('2026-03-01', '2026-01-01T00:00:00Z', 'soon')
    const later = voucher('2026-09-01', '2026-01-01T00:00:00Z', 'later')
    expect(order([later, soon])).toEqual(['soon', 'later'])
  })

  it('breaks ties on the date added, oldest first', () => {
    const older = voucher('2026-03-01', '2026-01-01T00:00:00Z', 'older')
    const newer = voucher('2026-03-01', '2026-02-01T00:00:00Z', 'newer')
    expect(order([newer, older])).toEqual(['older', 'newer'])
  })

  it('sends vouchers with no expiry to the back', () => {
    // No date means it never becomes urgent, so it must not displace one that
    // does -- even when it was added long before.
    const undated = voucher(null, '2020-01-01T00:00:00Z', 'undated')
    const dated = voucher('2099-12-31', '2026-01-01T00:00:00Z', 'dated')
    expect(order([undated, dated])).toEqual(['dated', 'undated'])
  })

  it('orders the undated ones among themselves by date added', () => {
    const first = voucher(null, '2026-01-01T00:00:00Z', 'first')
    const second = voucher(null, '2026-06-01T00:00:00Z', 'second')
    expect(order([second, first])).toEqual(['first', 'second'])
  })

  it('reverses only the date when asked for newest expiry first', () => {
    const old = voucher('2024-01-01', '2026-01-01T00:00:00Z', 'old')
    const recent = voucher('2026-08-01', '2026-01-01T00:00:00Z', 'recent')
    expect(order([old, recent], true)).toEqual(['recent', 'old'])
  })

  it('keeps the added-date tie-break oldest-first when reversed', () => {
    // Only the expiry comparison flips; the secondary ordering is the same
    // wherever the list appears.
    const older = voucher('2024-01-01', '2026-01-01T00:00:00Z', 'older')
    const newer = voucher('2024-01-01', '2026-02-01T00:00:00Z', 'newer')
    expect(order([newer, older], true)).toEqual(['older', 'newer'])
  })

  it('ignores an unparseable date rather than ordering by it', () => {
    const broken = voucher('not-a-date', '2026-01-01T00:00:00Z', 'broken')
    const dated = voucher('2026-03-01', '2026-06-01T00:00:00Z', 'dated')
    expect(order([broken, dated])).toEqual(['dated', 'broken'])
  })

  it('is a total order — sorting is stable and repeatable', () => {
    const list = [
      voucher('2026-05-01', '2026-01-03T00:00:00Z', 'c'),
      voucher(null, '2026-01-01T00:00:00Z', 'e'),
      voucher('2026-01-01', '2026-01-02T00:00:00Z', 'a'),
      voucher('2026-05-01', '2026-01-01T00:00:00Z', 'b'),
      voucher(null, '2026-01-05T00:00:00Z', 'f'),
    ]
    expect(order(list)).toEqual(['a', 'b', 'c', 'e', 'f'])
    expect(order(order(list).map((id) => list.find((v) => v.id === id)!))).toEqual([
      'a', 'b', 'c', 'e', 'f',
    ])
  })
})
