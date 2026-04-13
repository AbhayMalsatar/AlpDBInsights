import { apiClient } from './client'
import type { AIRequest, AIResponse } from '@/types'

export const aiApi = {
  chat: async (request: AIRequest): Promise<AIResponse> => {
    const { data } = await apiClient.post('/ai/chat', request)
    return data
  },

  generateSQL: async (prompt: string, databaseId: string, schemaContext?: string): Promise<{ sql: string }> => {
    const { data } = await apiClient.post('/ai/generate-sql', { prompt, databaseId, schemaContext })
    return data
  },

  detectIntent: async (message: string): Promise<{ intent: string; confidence: number }> => {
    const { data } = await apiClient.post('/ai/detect-intent', { message })
    return data
  },
}
