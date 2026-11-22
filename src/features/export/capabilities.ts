/**
 * Real capability detection for the export milestone. Nothing here encodes
 * video yet; it reports what this browser could use.
 */
export interface ExportCapabilities {
  webCodecs: boolean;
  videoEncoderH264: boolean | null;
  mediaRecorder: boolean;
  recorderTypes: string[];
  canvasCaptureStream: boolean;
}

const RECORDER_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export async function detectExportCapabilities(): Promise<ExportCapabilities> {
  const webCodecs = typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'function';
  let videoEncoderH264: boolean | null = null;
  if (webCodecs) {
    try {
      const VE = (window as unknown as { VideoEncoder: { isConfigSupported(c: object): Promise<{ supported: boolean }> } }).VideoEncoder;
      const r = await VE.isConfigSupported({ codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 });
      videoEncoderH264 = !!r.supported;
    } catch {
      videoEncoderH264 = false;
    }
  }
  const mediaRecorder = typeof MediaRecorder === 'function';
  const recorderTypes = mediaRecorder ? RECORDER_CANDIDATES.filter((t) => MediaRecorder.isTypeSupported?.(t)) : [];
  const canvasCaptureStream = typeof HTMLCanvasElement.prototype.captureStream === 'function';
  return { webCodecs, videoEncoderH264, mediaRecorder, recorderTypes, canvasCaptureStream };
}
