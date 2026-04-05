import { MessagingProvider, SendResult } from '@/lib/providers/types'

type UnofficialMode = 'push_text' | 'push_image_text' | 'broadcast_text' | 'broadcast_image_text'

export class UnofficialLineProvider implements MessagingProvider {
  name = 'unofficial_line' as const

  constructor(
    private readonly endpoint: string,
    private readonly token?: string,
  ) {}

  private async call(mode: UnofficialMode, payload: Record<string, string>): Promise<SendResult> {
    if (!this.endpoint) {
      return { success: false, error: 'Unofficial endpoint not configured', provider: this.name }
    }

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ mode, ...payload }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { success: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`, provider: this.name }
      }

      const data = await res.json().catch(() => ({}))
      if (data?.success === false) {
        return { success: false, error: data.error || 'Unofficial provider returned failure', provider: this.name }
      }

      return { success: true, provider: this.name }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error', provider: this.name }
    }
  }

  pushText(to: string, text: string): Promise<SendResult> {
    return this.call('push_text', { to, text })
  }

  pushImageAndText(to: string, imageUrl: string, text: string): Promise<SendResult> {
    return this.call('push_image_text', { to, imageUrl, text })
  }

  broadcastText(text: string): Promise<SendResult> {
    return this.call('broadcast_text', { text })
  }

  broadcastImageAndText(imageUrl: string, text: string): Promise<SendResult> {
    return this.call('broadcast_image_text', { imageUrl, text })
  }
}
