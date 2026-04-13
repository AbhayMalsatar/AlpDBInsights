import { apiClient } from './client'
import type { TableSchema } from '@/types'

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
}
