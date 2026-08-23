import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, VOUCHER_PHOTOS_BUCKET } from '../lib/supabase'
import type { VoucherFormInput, Voucher, VoucherStatus } from '../types'
import { useAuth } from './AuthContext'
import { duplicateMessage, findVoucherByCode as findByCode } from '../lib/vouchers'

export type ClaimOutcome = 'created' | 'already_in_group' | 'own_voucher' | 'code_conflict'

export interface ClaimResult {
  error: string | null
  outcome: ClaimOutcome | null
  voucher: Voucher | null
}

interface VouchersContextValue {
  vouchers: Voucher[]
  active: Voucher[]
  used: Voucher[]
  loading: boolean
  error: string | null
  addVoucher: (input: VoucherFormInput) => Promise<{ error: string | null }>
  updateVoucher: (id: string, input: VoucherFormInput) => Promise<{ error: string | null }>
  markAsUsed: (id: string) => Promise<{ error: string | null }>
  markAsActive: (id: string) => Promise<{ error: string | null }>
  removeVoucher: (id: string, photoPath: string | null) => Promise<{ error: string | null }>
  findVoucherByCode: (code: string, excludeId?: string) => Voucher | null
  getVoucher: (id: string) => Voucher | null
  createShareLink: (id: string) => Promise<{ url: string | null; error: string | null }>
  claimShare: (token: string) => Promise<ClaimResult>
  linkShare: (token: string, voucherId: string) => Promise<{ error: string | null }>
  getPhotoUrl: (photoPath: string) => Promise<string | null>
  refresh: () => Promise<void>
}

const VouchersContext = createContext<VouchersContextValue | undefined>(undefined)

export function VouchersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase
      .from('vouchers')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setVouchers(data as Voucher[])
    setLoading(false)
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  function findVoucherByCode(code: string, excludeId?: string) {
    return findByCode(vouchers, code, excludeId)
  }

  function getVoucher(id: string) {
    return vouchers.find((v) => v.id === id) ?? null
  }

  async function uploadPhoto(voucherId: string, file: File) {
    if (!user) return { path: null as string | null, error: 'לא מחוברים' }
    // The filename is user-controlled, and it lands in the storage object key.
    // Keep only a short alphanumeric extension so nothing can steer the path.
    const rawExt = file.name.split('.').pop() ?? ''
    const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
    const path = `${user.id}/${voucherId}.${ext}`
    const { error } = await supabase.storage
      .from(VOUCHER_PHOTOS_BUCKET)
      .upload(path, file, { upsert: true })
    if (error) return { path: null, error: error.message }
    return { path, error: null }
  }

  async function addVoucher(input: VoucherFormInput) {
    if (!user) return { error: 'לא מחוברים' }

    const duplicate = findVoucherByCode(input.code)
    if (duplicate) return { error: duplicateMessage(duplicate) }

    const { data: inserted, error: insertError } = await supabase
      .from('vouchers')
      .insert({
        user_id: user.id,
        store_name: input.store_name,
        code: input.code,
        amount: input.amount,
        note: input.note,
      })
      .select()
      .single()

    if (insertError || !inserted) return { error: insertError?.message ?? 'שמירת השובר נכשלה' }

    if (input.photoFile) {
      const { path, error: uploadError } = await uploadPhoto(inserted.id, input.photoFile)
      if (uploadError) return { error: uploadError }

      const { error: updateError } = await supabase
        .from('vouchers')
        .update({ photo_path: path })
        .eq('id', inserted.id)

      if (updateError) return { error: updateError.message }
    }

    await refresh()
    return { error: null }
  }

  async function updateVoucher(id: string, input: VoucherFormInput) {
    if (!user) return { error: 'לא מחוברים' }

    const current = getVoucher(id)
    const duplicate = findVoucherByCode(input.code, id)
    if (duplicate) return { error: duplicateMessage(duplicate) }

    let photoPath = current?.photo_path ?? null

    if (input.photoFile) {
      const { path, error: uploadError } = await uploadPhoto(id, input.photoFile)
      if (uploadError) return { error: uploadError }
      if (photoPath && photoPath !== path) {
        await supabase.storage.from(VOUCHER_PHOTOS_BUCKET).remove([photoPath])
      }
      photoPath = path
    } else if (input.removePhoto && photoPath) {
      await supabase.storage.from(VOUCHER_PHOTOS_BUCKET).remove([photoPath])
      photoPath = null
    }

    const { error } = await supabase
      .from('vouchers')
      .update({
        store_name: input.store_name,
        code: input.code,
        amount: input.amount,
        note: input.note,
        photo_path: photoPath,
      })
      .eq('id', id)

    if (error) return { error: error.message }

    await refresh()
    return { error: null }
  }

  async function setStatus(id: string, status: VoucherStatus) {
    const { error } = await supabase.rpc('set_voucher_status', {
      p_voucher_id: id,
      p_status: status,
    })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function markAsUsed(id: string) {
    return setStatus(id, 'used')
  }

  async function markAsActive(id: string) {
    return setStatus(id, 'active')
  }

  async function removeVoucher(id: string, photoPath: string | null) {
    if (photoPath) {
      await supabase.storage.from(VOUCHER_PHOTOS_BUCKET).remove([photoPath])
    }
    const { error } = await supabase.from('vouchers').delete().eq('id', id)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function createShareLink(id: string) {
    const { data, error } = await supabase.rpc('create_voucher_share', { p_voucher_id: id })
    if (error || !data) return { url: null, error: error?.message ?? 'יצירת קישור השיתוף נכשלה' }
    await refresh()
    return { url: `${window.location.origin}/claim/${data as string}`, error: null }
  }

  async function claimShare(token: string): Promise<ClaimResult> {
    const { data, error } = await supabase.rpc('claim_voucher_share', { p_token: token })
    if (error) return { error: error.message, outcome: null, voucher: null }

    const row = Array.isArray(data) ? data[0] : data
    if (!row) return { error: 'קישור השיתוף אינו תקין.', outcome: null, voucher: null }

    await refresh()

    const { data: claimed } = await supabase
      .from('vouchers')
      .select('*')
      .eq('id', row.voucher_id)
      .single()

    return {
      error: null,
      outcome: row.outcome as ClaimOutcome,
      voucher: (claimed as Voucher) ?? null,
    }
  }

  /** Explicit opt-in merge, after claimShare reported a code_conflict. */
  async function linkShare(token: string, voucherId: string) {
    const { error } = await supabase.rpc('link_voucher_to_share', {
      p_token: token,
      p_voucher_id: voucherId,
    })
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function getPhotoUrl(photoPath: string) {
    const { data, error } = await supabase.storage
      .from(VOUCHER_PHOTOS_BUCKET)
      .createSignedUrl(photoPath, 3600)
    if (error) return null
    return data.signedUrl
  }

  const active = vouchers.filter((v) => v.status === 'active')
  const used = vouchers.filter((v) => v.status === 'used')

  return (
    <VouchersContext.Provider
      value={{
        vouchers,
        active,
        used,
        loading,
        error,
        addVoucher,
        updateVoucher,
        markAsUsed,
        markAsActive,
        removeVoucher,
        findVoucherByCode,
        getVoucher,
        createShareLink,
        claimShare,
        linkShare,
        getPhotoUrl,
        refresh,
      }}
    >
      {children}
    </VouchersContext.Provider>
  )
}

export function useVouchers() {
  const ctx = useContext(VouchersContext)
  if (!ctx) throw new Error('useVouchers must be used within a VouchersProvider')
  return ctx
}
