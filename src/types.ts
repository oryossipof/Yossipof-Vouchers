export type VoucherStatus = 'active' | 'used'

export interface Voucher {
  id: string
  user_id: string
  store_name: string
  code: string
  amount: number
  photo_path: string | null
  status: VoucherStatus
  created_at: string
  used_at: string | null
}

export interface NewVoucherInput {
  store_name: string
  code: string
  amount: number
  photoFile: File | null
}
