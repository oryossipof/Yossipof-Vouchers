import type { Voucher } from '../types'

/** Beyond this the message becomes a wall of store names, so the rest is summarised. */
const MAX_LISTED = 10

export function whatsappUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** "שובר אחד" reads better than "1 שוברים" when only one is left to share. */
function countPhrase(n: number) {
  return n === 1 ? 'שובר אחד' : `${n} שוברים`
}

export function shareOneMessage(voucher: Voucher, link: string) {
  return [
    `שיתפתי איתך שובר של ${voucher.store_name}.`,
    'לחיצה על הקישור תוסיף אותו לחשבון שלך, ומרגע זה סימון "נוצל" יחול על שני החשבונות:',
    link,
  ].join('\n')
}

/**
 * The message behind "share all". It names the stores rather than only the
 * count, so the recipient can see what they are being sent before opening the
 * link, and caps the list so a large collection stays readable in a chat.
 */
export function shareAllMessage(vouchers: Voucher[], link: string) {
  const listed = vouchers.slice(0, MAX_LISTED).map((v) => `• ${v.store_name}`)
  const rest = vouchers.length - listed.length
  if (rest > 0) listed.push(`• ועוד ${countPhrase(rest)}`)

  return [
    `שיתפתי איתך ${countPhrase(vouchers.length)}:`,
    ...listed,
    '',
    'לחיצה אחת על הקישור תוסיף את כולם לחשבון שלך, ומרגע זה סימון "נוצל" יחול על שני החשבונות:',
    link,
  ].join('\n')
}

const SHARE_ERRORS: Record<string, string> = {
  'Only the person who shared this voucher can share it further':
    'רק מי ששיתף את השובר במקור יכול לשתף אותו הלאה.',
  'Only the owner can share this voucher': 'אפשר לשתף רק שוברים שאתם הבעלים שלהם.',
  'No vouchers to share': 'אין שוברים לשיתוף.',
  'Too many vouchers in one share link': 'יש יותר מדי שוברים לקישור אחד. שתפו אותם בקבוצות.',
  'Not authenticated': 'יש להתחבר כדי לשתף.',
  'Voucher not found': 'השובר לא נמצא.',
}

/** Postgres raises these in English; the UI is Hebrew. */
export function translateShareError(message: string) {
  const key = Object.keys(SHARE_ERRORS).find((k) => message.includes(k))
  return key ? SHARE_ERRORS[key] : message
}
