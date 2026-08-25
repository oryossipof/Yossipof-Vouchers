export type VoucherStatus = 'active' | 'used'

export interface Voucher {
  id: string
  /** The owner. Everyone else with access is a member of the share. */
  user_id: string
  store_name: string
  code: string
  amount: number | null
  note: string | null
  photo_path: string | null
  status: VoucherStatus
  created_at: string
  used_at: string | null
  /** Last day the voucher is valid, as `YYYY-MM-DD`. Null means it never expires. */
  expires_at: string | null
}

export interface VoucherFormInput {
  store_name: string
  code: string
  amount: number | null
  note: string | null
  /** `YYYY-MM-DD`, or null. The form takes it as dd/mm/yyyy and converts. */
  expires_at: string | null
  photoFile: File | null
  removePhoto: boolean
}

export type NewVoucherInput = VoucherFormInput
