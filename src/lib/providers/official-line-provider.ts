import {
  pushTextMessage as linePushText,
  pushImageAndText as linePushImageAndText,
  broadcastText as lineBroadcastText,
  broadcastImageAndText as lineBroadcastImageAndText,
} from '@/lib/line-messaging'
import { MessagingProvider, SendResult } from '@/lib/providers/types'

export class OfficialLineProvider implements MessagingProvider {
  name = 'official_line' as const

  constructor(private readonly channelAccessToken: string) {}

  private ensureChannelAccessTokenConfigured(): void {
    if (!this.channelAccessToken.trim()) {
      throw new Error('LINE channel access token is not configured')
    }
  }

  async pushText(to: string, text: string): Promise<SendResult> {
    this.ensureChannelAccessTokenConfigured()
    const r = await linePushText(this.channelAccessToken, to, text)
    return { ...r, provider: this.name }
  }

  async pushImageAndText(to: string, imageUrl: string, text: string): Promise<SendResult> {
    this.ensureChannelAccessTokenConfigured()
    const r = await linePushImageAndText(this.channelAccessToken, to, imageUrl, text)
    return { ...r, provider: this.name }
  }

  async broadcastText(text: string): Promise<SendResult> {
    this.ensureChannelAccessTokenConfigured()
    const r = await lineBroadcastText(this.channelAccessToken, text)
    return { ...r, provider: this.name }
  }

  async broadcastImageAndText(imageUrl: string, text: string): Promise<SendResult> {
    this.ensureChannelAccessTokenConfigured()
    const r = await lineBroadcastImageAndText(this.channelAccessToken, imageUrl, text)
    return { ...r, provider: this.name }
  }
}
