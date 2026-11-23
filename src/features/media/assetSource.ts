/**
 * Where an asset's bytes come from: the original File (browser import) or a
 * streaming URL (desktop projects reopened from disk via media://).
 */
import type { Source } from 'mediabunny';
import { getAssetFile, useMediaStore } from '../../stores/mediaStore';

export type AssetData = File | string;

export function getAssetData(id: string): AssetData | undefined {
  const f = getAssetFile(id);
  if (f) return f;
  const a = useMediaStore.getState().assets[id];
  return a?.path ? a.url : undefined;
}

export async function makeSource(data: AssetData): Promise<Source> {
  const { BlobSource, UrlSource } = await import('mediabunny');
  return typeof data === 'string' ? new UrlSource(data) : new BlobSource(data);
}

export async function readAll(data: AssetData): Promise<ArrayBuffer> {
  return typeof data === 'string' ? (await fetch(data)).arrayBuffer() : data.arrayBuffer();
}

export function dataSize(data: AssetData, fallback: number): number {
  return typeof data === 'string' ? fallback : data.size;
}
