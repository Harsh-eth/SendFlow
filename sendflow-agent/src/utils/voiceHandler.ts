import { loggerCompat as logger } from "./structuredLogger";

export async function transcribeVoice(fileBuffer: Buffer, whisperEndpoint?: string): Promise<string | null> {
  const endpoint = whisperEndpoint || process.env.WHISPER_ENDPOINT;
  if (!endpoint) {
    logger.warn("WHISPER_ENDPOINT not configured — voice messages cannot be transcribed");
    return null;
  }

  try {
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "audio/ogg" });
    formData.append("file", blob, "voice.ogg");
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");

    const res = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      logger.warn(`Whisper transcription failed: ${res.status}`);
      return null;
    }

    const text = await res.text();
    return text.trim() || null;
  } catch (err) {
    logger.warn(`Voice transcription error: ${err}`);
    return null;
  }
}

export async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer | null> {
  try {
    const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    if (!fileInfoRes.ok) return null;
    const fileInfo = (await fileInfoRes.json()) as { result?: { file_path?: string } };
    const filePath = fileInfo.result?.file_path;
    if (!filePath) return null;

    const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!fileRes.ok) return null;
    const arrayBuf = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  }
}
