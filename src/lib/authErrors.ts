const AUTH_ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid login credentials': 'אימייל או סיסמה שגויים.',
  'Email not confirmed': 'האימייל טרם אושר. בדקו את תיבת הדואר שלכם.',
  'User already registered': 'כבר קיים חשבון עם אימייל זה.',
  'Password should be at least 6 characters.': 'הסיסמה חייבת להכיל לפחות 6 תווים.',
  'Email link is invalid or has expired': 'קישור האישור אינו תקין או שפג תוקפו.',
  'Token has expired or is invalid': 'קישור האישור אינו תקין או שפג תוקפו.',
}

export function translateAuthError(message: string) {
  return AUTH_ERROR_TRANSLATIONS[message] ?? message
}
