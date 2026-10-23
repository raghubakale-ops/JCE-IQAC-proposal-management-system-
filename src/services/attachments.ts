import { supabase, unwrap } from './api'
import type { Attachment, AttachmentKind } from '../types'

export type Bucket = 'proposal-docs' | 'report-evidence'
const MIME: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
}

/** Upload to private storage, then register in the database. The database verifies the object really exists. */
export async function uploadAttachment(bucket: Bucket, parentId: string, file: File, kind: AttachmentKind): Promise<Attachment> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const path = `${parentId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(bucket).upload(path, file, { contentType: MIME[ext] ?? file.type, upsert: false })
  if (up.error) throw up.error
  try {
    const args = bucket === 'proposal-docs'
      ? { fn: 'register_proposal_attachment', a: { p_proposal_id: parentId, p_path: path, p_file_name: file.name, p_kind: kind } }
      : { fn: 'register_report_attachment', a: { p_report_id: parentId, p_path: path, p_file_name: file.name, p_kind: kind } }
    return unwrap<Attachment>(await supabase.rpc(args.fn, args.a) as never)
  } catch (e) {
    await supabase.storage.from(bucket).remove([path])   // best-effort: do not leave an unregistered file behind
    throw e
  }
}

export async function openAttachment(bucket: Bucket, path: string): Promise<void> {
  const res = await supabase.storage.from(bucket).createSignedUrl(path, 60)   // short-lived, authenticated
  if (res.error || !res.data) throw res.error ?? { message: 'Could not create a download link.' }
  window.open(res.data.signedUrl, '_blank', 'noopener')
}

export async function removeAttachment(bucket: Bucket, att: Attachment): Promise<void> {
  const rm = await supabase.storage.from(bucket).remove([att.storage_path])
  if (rm.error) throw rm.error
  const table = bucket === 'proposal-docs' ? 'proposal_attachments' : 'activity_report_attachments'
  const rows = unwrap<{ id: string }[]>(await supabase.from(table).delete().eq('id', att.id).select('id') as never)
  if (!rows?.length) throw { message: 'The file could not be removed (the record may no longer be editable).' }
}
