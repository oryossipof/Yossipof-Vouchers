import { describe, expect, it } from 'vitest'
import type { Voucher } from '../types'
import { shareAllMessage, shareOneMessage, translateShareError, whatsappUrl } from './share'

function voucher(store: string, id = store): Voucher {
  return {
    id,
    user_id: 'u1',
    store_name: store,
    code: 'ABC-123',
    amount: null,
    note: null,
    photo_path: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    used_at: null,
  }
}

const LINK = 'https://example.com/claim-all/token'

describe('shareOneMessage', () => {
  it('names the store and ends with the link', () => {
    const text = shareOneMessage(voucher('סופר-פארם'), LINK)
    expect(text).toContain('סופר-פארם')
    expect(text.endsWith(LINK)).toBe(true)
  })
})

describe('shareAllMessage', () => {
  it('lists every store when the collection is small', () => {
    const text = shareAllMessage([voucher('א'), voucher('ב'), voucher('ג')], LINK)
    expect(text).toContain('3 שוברים')
    expect(text).toContain('• א')
    expect(text).toContain('• ג')
    expect(text).not.toContain('ועוד')
    expect(text.endsWith(LINK)).toBe(true)
  })

  it('caps the list and summarises the remainder', () => {
    const many = Array.from({ length: 13 }, (_, i) => voucher(`חנות ${i}`, `v${i}`))
    const text = shareAllMessage(many, LINK)
    expect(text).toContain('13 שוברים')
    expect(text).toContain('• חנות 9')
    expect(text).not.toContain('• חנות 10')
    expect(text).toContain('ועוד 3 שוברים')
  })

  it('uses the singular phrasing for a remainder of one', () => {
    const many = Array.from({ length: 11 }, (_, i) => voucher(`חנות ${i}`, `v${i}`))
    expect(shareAllMessage(many, LINK)).toContain('ועוד שובר אחד')
  })
})

describe('whatsappUrl', () => {
  it('encodes the message into a wa.me link', () => {
    const url = whatsappUrl('שלום\nעולם')
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(url).toContain('%0A')
    expect(url).not.toContain('\n')
  })
})

describe('translateShareError', () => {
  it('translates a known database error', () => {
    expect(translateShareError('Only the owner can share this voucher')).toBe(
      'אפשר לשתף רק שוברים שאתם הבעלים שלהם.'
    )
  })

  it('passes an unknown message through unchanged', () => {
    expect(translateShareError('boom')).toBe('boom')
  })
})
