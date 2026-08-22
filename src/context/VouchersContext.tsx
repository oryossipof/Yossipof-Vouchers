import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, VOUCHER_PHOTOS_BUCKET } from '../lib/supabase'
import type { NewVoucherInput, Voucher } from '../types'
import { useAuth } from './AuthContext'

interface VouchersContextValue {
  vouchers: Voucher[]
  active: Voucher[]
  used: Voucher[]
  loading: boolean
  error: string | null
  addVoucher: (input: NewVoucherInput) => Promise<{ error: string | null }>
  markAsUsed: (id: string) => Promise<{ error: string | null }>
  markAsActive: (id: string) => Promise<{ error: string | null }>
  removeVoucher: (id: string, photoPath: string | null) => Promise<{ error: string | null }>
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

  async function addVoucher(input: NewVoucherInput) {
    if (!user) return { error: 'Not signed in' }

    const { data: inserted, error: insertError } = await supabase
      .from('vouchers')
      .insert({
        user_id: user.id,
        store_name: input.store_name,
        code: input.code,
        amount: input.amount,
      })
      .select()
      .single()

    if (insertError || !inserted) return { error: insertError?.message ?? 'Failed to save voucher' }

    if (input.photoFile) {
      const ext = input.photoFile.name.split('.').pop() || 'jpg'
      const path = `${user.id}/${inserted.id}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from(VOUCHER_PHOTOS_BUCKET)
        .upload(path, input.photoFile, { upsert: true })

      if (uploadError) return { error: uploadError.message }

      const { error: updateError } = await supabase
        .from('vouchers')
        .update({ photo_path: path })
        .eq('id', inserted.id)

      if (updateError) return { error: updateError.message }
    }

    await refresh()
    return { error: null }
  }

  async function markAsUsed(id: string) {
    const { error } = await supabase
      .from('vouchers')
      .update({ status: 'used', used_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function markAsActive(id: string) {
    const { error } = await supabase
      .from('vouchers')
      .update({ status: 'active', used_at: null })
      .eq('id', id)
    if (!error) await refresh()
    return { error: error?.message ?? null }
  }

  async function removeVoucher(id: string, photoPath: string | null) {
    if (photoPath) {
      await supabase.storage.from(VOUCHER_PHOTOS_BUCKET).remove([photoPath])
    }
    const { error } = await supabase.from('vouchers').delete().eq('id', id)
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
      value={{ vouchers, active, used, loading, error, addVoucher, markAsUsed, markAsActive, removeVoucher, getPhotoUrl, refresh }}
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
