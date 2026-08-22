export type VoucherStatus = 'active' | 'used'

export interface Voucher {
  id: string
  user_id: string
  store_name: string
  code: string
  amount: number | null
  photo_path: string | null
  status: VoucherStatus
  created_at: string
  used_at: string | null
}

export interface NewVoucherInput {
  store_name: string
  code: string
  amount: number | null
  photoFile: File | null
}
