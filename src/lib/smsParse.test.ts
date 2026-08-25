import { describe, expect, it } from 'vitest'
import { isEmptyParse, normalizeParsedVoucher, translateParseError } from './smsParse'

const TODAY = '2026-08-25'

describe('normalizeParsedVoucher', () => {
  it('passes a well-formed parse straight through', () => {
    expect(
      normalizeParsedVoucher(
        {
          store_name: 'קסטרו',
          code: 'CST-8842-XQ',
          amount: 150,
          expires_at: '2026-11-30',
          note: 'לא כולל פריטי סייל',
        },
        TODAY
      )
    ).toEqual({
      store_name: 'קסטרו',
      code: 'CST-8842-XQ',
      amount: 150,
      expires_at: '2026-11-30',
      note: 'לא כולל פריטי סייל',
    })
  })

  it('fills in nulls rather than failing on a partial parse', () => {
    expect(normalizeParsedVoucher({ store_name: 'איקאה' }, TODAY)).toEqual({
      store_name: 'איקאה',
      code: null,
      amount: null,
      expires_at: null,
      note: null,
    })
  })

  it('survives junk input', () => {
    const empty = {
      store_name: null,
      code: null,
      amount: null,
      expires_at: null,
      note: null,
    }
    expect(normalizeParsedVoucher(null, TODAY)).toEqual(empty)
    expect(normalizeParsedVoucher(undefined, TODAY)).toEqual(empty)
    expect(normalizeParsedVoucher('not an object', TODAY)).toEqual(empty)
    expect(normalizeParsedVoucher(42, TODAY)).toEqual(empty)
  })

  describe('amount', () => {
    it('reads a number given as a string', () => {
      expect(normalizeParsedVoucher({ amount: '150' }, TODAY).amount).toBe(150)
    })

    it('strips a currency symbol the model left in', () => {
      expect(normalizeParsedVoucher({ amount: '150 ₪' }, TODAY).amount).toBe(150)
      expect(normalizeParsedVoucher({ amount: '₪99.90' }, TODAY).amount).toBe(99.9)
    })

    it('rounds to the two decimals the column holds', () => {
      expect(normalizeParsedVoucher({ amount: 33.333 }, TODAY).amount).toBe(33.33)
    })

    it('rejects values the amount check would refuse anyway', () => {
      // The column has a `> 0` constraint, so these have to become null here
      // or the save fails with a database error instead of an empty field.
      expect(normalizeParsedVoucher({ amount: 0 }, TODAY).amount).toBeNull()
      expect(normalizeParsedVoucher({ amount: -50 }, TODAY).amount).toBeNull()
      expect(normalizeParsedVoucher({ amount: 'חינם' }, TODAY).amount).toBeNull()
      expect(normalizeParsedVoucher({ amount: NaN }, TODAY).amount).toBeNull()
      expect(normalizeParsedVoucher({ amount: Infinity }, TODAY).amount).toBeNull()
      expect(normalizeParsedVoucher({ amount: {} }, TODAY).amount).toBeNull()
    })
  })

  describe('expires_at', () => {
    it('accepts a real ISO date', () => {
      expect(normalizeParsedVoucher({ expires_at: '2026-11-30' }, TODAY).expires_at).toBe(
        '2026-11-30'
      )
    })

    it('accepts a date in the past — the voucher just lands under "expired"', () => {
      expect(normalizeParsedVoucher({ expires_at: '2020-01-01' }, TODAY).expires_at).toBe(
        '2020-01-01'
      )
    })

    it('rejects a day that does not exist', () => {
      expect(normalizeParsedVoucher({ expires_at: '2026-02-31' }, TODAY).expires_at).toBeNull()
    })

    it('rejects anything not in ISO shape', () => {
      // The function asks for YYYY-MM-DD; a dd/mm/yyyy answer means the model
      // ignored the instruction, and guessing which way round it is would be
      // worse than leaving the field for the user.
      expect(normalizeParsedVoucher({ expires_at: '30/11/2026' }, TODAY).expires_at).toBeNull()
      expect(normalizeParsedVoucher({ expires_at: 'סוף השנה' }, TODAY).expires_at).toBeNull()
      expect(normalizeParsedVoucher({ expires_at: 20261130 }, TODAY).expires_at).toBeNull()
    })

    it('rejects an absurdly distant date', () => {
      // Usually the model mis-reading a two-digit year. Accepting it would
      // silently park the voucher where no reminder ever fires.
      expect(normalizeParsedVoucher({ expires_at: '2126-11-30' }, TODAY).expires_at).toBeNull()
    })

    it('accepts a date just inside the ten-year limit', () => {
      expect(normalizeParsedVoucher({ expires_at: '2036-08-25' }, TODAY).expires_at).toBe(
        '2036-08-25'
      )
      expect(normalizeParsedVoucher({ expires_at: '2036-08-26' }, TODAY).expires_at).toBeNull()
    })
  })

  describe('text fields', () => {
    it('trims whitespace', () => {
      expect(normalizeParsedVoucher({ store_name: '  קסטרו  ' }, TODAY).store_name).toBe('קסטרו')
    })

    it('treats a whitespace-only value as absent', () => {
      expect(normalizeParsedVoucher({ store_name: '   ' }, TODAY).store_name).toBeNull()
    })

    it('caps a runaway response', () => {
      const long = 'א'.repeat(5000)
      expect(normalizeParsedVoucher({ store_name: long }, TODAY).store_name).toHaveLength(120)
      // The note carries the whole original message, so its ceiling sits past
      // the length of any real SMS rather than down at a single field's worth.
      expect(normalizeParsedVoucher({ note: long }, TODAY).note).toHaveLength(2000)
    })

    it('ignores non-strings', () => {
      expect(normalizeParsedVoucher({ store_name: 123 }, TODAY).store_name).toBeNull()
      expect(normalizeParsedVoucher({ code: ['A', 'B'] }, TODAY).code).toBeNull()
    })
  })
})

describe('isEmptyParse', () => {
  it('is true when nothing was found', () => {
    expect(isEmptyParse(normalizeParsedVoucher({}, TODAY))).toBe(true)
  })

  it('is false when even one field came back', () => {
    expect(isEmptyParse(normalizeParsedVoucher({ code: 'ABC' }, TODAY))).toBe(false)
    expect(isEmptyParse(normalizeParsedVoucher({ amount: 50 }, TODAY))).toBe(false)
  })
})

describe('translateParseError', () => {
  it('translates the errors the function raises', () => {
    expect(translateParseError('Parser unavailable')).toContain('אינו זמין')
    expect(translateParseError('Message too long')).toContain('ארוכה מדי')
  })

  it('matches when the message is wrapped in other text', () => {
    expect(translateParseError('Edge Function error: Parser is not configured')).toContain(
      'אינו זמין'
    )
  })

  it('falls back to a Hebrew message for anything unrecognised', () => {
    const out = translateParseError('some unexpected network failure')
    expect(out).toContain('נכשל')
    // Never leak raw English at the user.
    expect(out).not.toContain('network')
  })
})
