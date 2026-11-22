import type { TrackKind } from '../../types/project';

export const RULER_H = 28;
export const TRACK_H: Record<TrackKind, number> = { video: 56, audio: 44, text: 36 };
export const TRACK_H_COMPACT: Record<TrackKind, number> = { video: 48, audio: 40, text: 34 };
export const HEADER_W = 132;
export const HEADER_W_COMPACT = 48;
/** Movement (CSS px) before a press becomes a drag. */
export const DRAG_SLOP = 6;
export const LONG_PRESS_MS = 450;
export const SNAP_PX = 10;
/** Trim handle hit width (CSS px) — generous for touch. */
export const HANDLE_W = 22;

/** DataTransfer type used when dragging library assets onto the timeline (desktop). */
export const ASSET_DRAG_TYPE = 'application/x-king-asset';
