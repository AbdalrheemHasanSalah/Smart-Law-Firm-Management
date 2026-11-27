import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, messageOf } from '@/lib/api'
import { useShareDocument } from '@/lib/portal'
import type { CaseRelationships, DocumentRecord } from '@/lib/types'
import { FormActions, Modal, SelectField } from './forms'
import { Button } from './kit'

/**
 * Shares a case document with one of the case's clients (it then appears in their portal and they
 * are notified), or stops sharing it so only the case team sees it.
 */
export const ShareDocument = ({ document, onClose }: { document: DocumentRecord | null; onClose: () => void }) => {
  const share = useShareDocument()
  const relationships = useQuery({
    queryKey: ['relationships', document?.case_id],
    enabled: document !== null,
    queryFn: async () => (await api.get<{ relationships: CaseRelationships }>(`/cases/${document!.case_id}/relationships`)).data.relationships,
  })
  const parties = relationships.data?.clients ?? []
  const [clientId, setClientId] = useState('')
  useEffect(() => {
    if (!document) return
    share.reset()
    setClientId(document.client_id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.document_id])
  useEffect(() => {
    if (!clientId && parties.length === 1) setClientId(parties[0]!.client_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parties.length])

  const shared = document?.access_level === 'authorized_users'
  return (
    <Modal open={document !== null} onClose={onClose} title={shared ? 'مشاركة المستند مع الموكّل' : 'مشاركة مع الموكّل'}>
      {document && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            share.mutate({ documentId: document.document_id, clientId }, { onSuccess: onClose })
          }}
          className="space-y-4"
        >
          <p className="text-sm text-ink"><bdi dir="ltr" className="font-semibold">{document.file_name}</bdi></p>
          <SelectField
            label="الموكّل الذي يراه"
            name="share_client"
            required
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            options={[['', relationships.isPending ? 'يُحمَّل…' : parties.length ? 'اختر موكّلاً' : 'لا موكّلين في هذه القضية'], ...parties.map((party) => [party.client_id, party.full_name_or_org] as const)]}
          />
          <p className="text-xs text-ink-faint">يظهر المستند في بوابة الموكّل ويصله إشعار بذلك. لا يرى الموكّلون الآخرون في القضية هذا المستند.</p>
          <FormActions error={share.isError ? messageOf(share.error) : null}>
            {shared && (
              <Button variant="line" disabled={share.isPending} onClick={() => share.mutate({ documentId: document.document_id, clientId: null }, { onSuccess: onClose })}>
                أوقف المشاركة
              </Button>
            )}
            <Button variant="line" onClick={onClose}>إلغاء</Button>
            <Button type="submit" variant="ink" disabled={!clientId || share.isPending || (shared && clientId === document.client_id)}>
              {share.isPending ? 'يُحفظ…' : 'شارك'}
            </Button>
          </FormActions>
        </form>
      )}
    </Modal>
  )
}
