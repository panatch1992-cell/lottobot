export type ProviderName = 'official_line' | 'unofficial_line'

export type SendResult = {
  success: boolean
  error?: string
  provider: ProviderName
}

export interface MessagingProvider {
  name: ProviderName
  pushText(to: string, text: string): Promise<SendResult>
  pushImageAndText(to: string, imageUrl: string, text: string): Promise<SendResult>
  broadcastText(text: string): Promise<SendResult>
  broadcastImageAndText(imageUrl: string, text: string): Promise<SendResult>
}
