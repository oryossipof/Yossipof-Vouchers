export type VoucherStatus = 'active' | 'used'

export interface Voucher {
  id: string
  user_id: string
  store_name: string
  code: string
  amount: number | null
  note: string | null
  photo_path: string | null
  status: VoucherStatus
  share_group_id: string | null
  share_origin: string | null
  created_at: string
  used_at: string | null
}

export interface VoucherFormInput {
  store_name: string
  code: string
  amount: number | null
  note: string | null
  photoFile: File | null
  removePhoto: boolean
}

export type NewVoucherInput = VoucherFormInput
