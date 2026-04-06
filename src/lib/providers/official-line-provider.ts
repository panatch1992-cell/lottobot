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

  async pushText(to: string, text: string): Promise<SendResult> {
    const r = await linePushText(this.channelAccessToken, to, text)
    return { ...r, provider: this.name }
  }

 async pushImageAndText(to: string, imageUrl: string, text: string): Promise<SendResult> {
  const target = (to ?? "").trim();
  const messageText = (text ?? "").trim();
  const rawImageUrl = (imageUrl ?? "").trim();

  if (!target) {
    return { success: false, error: "INVALID_TARGET" } as SendResult;
  }

  if (!messageText) {
    return { success: false, error: "EMPTY_TEXT" } as SendResult;
  }

  if (!rawImageUrl) {
    return { success: false, error: "EMPTY_IMAGE_URL" } as SendResult;
  }

  if (messageText.length > 5000) {
    return { success: false, error: "TEXT_TOO_LONG" } as SendResult;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawImageUrl);
  } catch {
    return { success: false, error: "INVALID_IMAGE_URL" } as SendResult;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { success: false, error: "INVALID_IMAGE_URL_PROTOCOL" } as SendResult;
  }

  const safeImageUrl = parsedUrl.toString();

  try {
    await this.client.pushMessage(target, [
      {
        type: "image",
        originalContentUrl: safeImageUrl,
        previewImageUrl: safeImageUrl,
      },
      {
        type: "text",
        text: messageText,
      },
    ]);

    return { success: true } as SendResult;
  } catch (error: any) {
    const status = error?.statusCode ?? error?.status ?? undefined;
    const message = error?.message ?? "LINE_PUSH_FAILED";

    console.error("[LINE] pushImageAndText failed", {
      status,
      message,
      toMasked: target.length > 6 ? `${target.slice(0, 3)}***${target.slice(-3)}` : "***",
      textLength: messageText.length,
    });

    return {
      success: false,
      error: message,
      statusCode: status,
    } as SendResult;
  }
}
  }

  async broadcastText(text: string): Promise<SendResult> {
    const r = await lineBroadcastText(this.channelAccessToken, text)
    return { ...r, provider: this.name }
  }

  async broadcastImageAndText(imageUrl: string, text: string): Promise<SendResult> {
    const r = await lineBroadcastImageAndText(this.channelAccessToken, imageUrl, text)
    return { ...r, provider: this.name }
  }
}
