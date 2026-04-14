import { apiClient } from './client'
import type { TableSchema } from '@/types'

export interface FineTuneStatus {
  status: string
  provider: string
  enabled: boolean
  active_model?: string | null
  fine_tuned_model?: string | null
  base_model?: string | null
  job_id?: string | null
  training_file_id?: string | null
  training_examples: number
  dataset_tables: string[]
  mode?: string | null
  last_started_at?: string | null
  last_completed_at?: string | null
  last_checked_at?: string | null
  last_error?: string | null
  message?: string | null
}

interface ConnectPayload {
  type: 'postgresql' | 'mssql'
  name: string
  host: string
  port: number
  username: string
  password: string
  database: string
}

export const databaseApi = {
  connect: async (payload: ConnectPayload): Promise<{ id: string; schema: TableSchema[] }> => {
    const { data } = await apiClient.post('/database/connect', payload)
    return data
  },

  getSchema: async (dbId: string): Promise<TableSchema[]> => {
    const { data } = await apiClient.get(`/database/${dbId}/schema`)
    return data
  },

  testConnection: async (payload: Omit<ConnectPayload, 'name'>): Promise<{ success: boolean; message: string }> => {
    const { data } = await apiClient.post('/database/test', payload)
    return data
  },

  disconnect: async (dbId: string): Promise<void> => {
    await apiClient.delete(`/database/${dbId}`)
  },

  executeQuery: async (dbId: string, sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> => {
    const { data } = await apiClient.post(`/database/${dbId}/query`, { sql })
    return data
  },

  getTableHints: async (
    dbId: string,
  ): Promise<{ hints: Record<string, unknown>; tables_overview: Record<string, unknown>[] }> => {
    const { data } = await apiClient.get(`/database/${dbId}/table-hints`)
    return data
  },

  putTableHints: async (
    dbId: string,
    body: { tables: Record<string, unknown> },
  ): Promise<{ ok: boolean; hints_fingerprint: string; reindexed_tables: string[] }> => {
    const { data } = await apiClient.put(`/database/${dbId}/table-hints`, body)
    return data
  },

  connectFromConnectionString: async (payload: {
    connection_string: string
    name?: string
  }): Promise<Record<string, unknown>> => {
    const { data } = await apiClient.post('/database/connect-string', payload)
    return data
  },

  getFineTuneStatus: async (dbId: string): Promise<FineTuneStatus> => {
    const { data } = await apiClient.get(`/database/${dbId}/fine-tune-status`)
    return data
  },

  startFineTune: async (
    dbId: string,
    body?: { table_names?: string[]; auto?: boolean },
  ): Promise<FineTuneStatus> => {
    const { data } = await apiClient.post(`/database/${dbId}/fine-tune`, body ?? {})
    return data
  },
}
