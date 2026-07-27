import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { checkNoApiKey, checkAiLimit } from '@/lib/apiKeyError'
import type {
  TrainingProgram, GeneratedProgram, GenerateProgramRequest, ActiveProgramResponse, ProgramDetailResponse,
} from './programTypes'

type ActiveResult = ActiveProgramResponse | { program: null }

export function useActiveProgram() {
  return useQuery<ActiveResult>({
    queryKey: ['program-active'],
    queryFn: async () => {
      const res = await fetch('/api/gym/program/active')
      if (!res.ok) throw new Error('Failed to fetch active program')
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function usePrograms() {
  return useQuery<TrainingProgram[]>({
    queryKey: ['programs'],
    queryFn: async () => {
      const res = await fetch('/api/gym/program')
      if (!res.ok) throw new Error('Failed to fetch programs')
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function useProgramDetail(id: string | null) {
  return useQuery<ProgramDetailResponse>({
    queryKey: ['program-detail', id],
    queryFn: async () => {
      const res = await fetch(`/api/gym/program/${id}`)
      if (!res.ok) throw new Error('Failed to fetch program')
      return res.json()
    },
    enabled: !!id,
    staleTime: 60_000,
  })
}

// One-shot generation (no caching) — returns the program for preview, unsaved.
export function useGenerateProgram() {
  return useMutation({
    mutationFn: async (req: GenerateProgramRequest) => {
      const res = await fetch('/api/gym/program/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      if (!res.ok) {
        const noKey = await checkNoApiKey(res)
        if (noKey) throw noKey
        const limit = await checkAiLimit(res)
        if (limit) throw limit
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? 'Generation failed')
      }
      return res.json() as Promise<GeneratedProgram>
    },
  })
}

export function useSaveProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (program: GeneratedProgram) => {
      const res = await fetch('/api/gym/program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(program),
      })
      if (!res.ok) throw new Error('Failed to save program')
      return res.json() as Promise<TrainingProgram>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['program-active'] })
      qc.invalidateQueries({ queryKey: ['programs'] })
      qc.invalidateQueries({ queryKey: ['gym-exercises'] }) // new exercises may have been created
    },
  })
}

export function useUpdateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; status?: string; start_date?: string | null }) => {
      const res = await fetch(`/api/gym/program/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to update program')
      return res.json() as Promise<TrainingProgram>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['program-active'] })
      qc.invalidateQueries({ queryKey: ['programs'] })
      qc.invalidateQueries({ queryKey: ['program-detail'] })
    },
  })
}

export function useDeleteProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/gym/program/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete program')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['program-active'] })
      qc.invalidateQueries({ queryKey: ['programs'] })
      qc.invalidateQueries({ queryKey: ['program-detail'] })
    },
  })
}
