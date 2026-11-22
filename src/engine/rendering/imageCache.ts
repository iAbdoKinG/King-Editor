/**
 * Decoded still images, keyed by asset id. Large images are downscaled once
 * to bound memory; entries are released when their asset is removed.
 */
import type { MediaAsset } from '../../types/project';

type Drawable = ImageBitmap | HTMLImageElement;
const MAX_EDGE = 2560;

class ImageCache {
  private entries = new Map<string, Drawable | 'loading' | 'error'>();
  onLoad: () => void = () => undefined;

  get(asset: MediaAsset): Drawable | null {
    const e = this.entries.get(asset.id);
    if (e === undefined) {
      this.entries.set(asset.id, 'loading');
      void this.load(asset);
      return null;
    }
    return typeof e === 'string' ? null : e;
  }

  private async load(asset: MediaAsset): Promise<void> {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = asset.url;
      await img.decode();
      let out: Drawable = img;
      const edge = Math.max(img.naturalWidth, img.naturalHeight);
      if (edge > MAX_EDGE && typeof createImageBitmap === 'function') {
        const k = MAX_EDGE / edge;
        try {
          out = await createImageBitmap(img, {
            resizeWidth: Math.round(img.naturalWidth * k),
            resizeHeight: Math.round(img.naturalHeight * k),
            resizeQuality: 'high',
          });
        } catch {
          out = img;
        }
      }
      if (!this.entries.has(asset.id)) {
        if ('close' in out) out.close();
        return; // released while loading
      }
      this.entries.set(asset.id, out);
      this.onLoad();
    } catch {
      if (this.entries.has(asset.id)) this.entries.set(asset.id, 'error');
    }
  }

  release(assetId: string): void {
    const e = this.entries.get(assetId);
    if (e && typeof e !== 'string' && 'close' in e) e.close();
    this.entries.delete(assetId);
  }
}

export const imageCache = new ImageCache();
