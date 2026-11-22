/** Core data model for KING EDITOR projects. All times are in seconds. */

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  size: number;
  mime: string;
  /** Session-only object URL. Revoked when the asset is removed. */
  url: string;
  /** Seconds. 0 for still images. */
  duration: number;
  width: number;
  height: number;
  thumbUrl?: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export type TrackKind = 'video' | 'audio' | 'text';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
}

export interface Crop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Transform {
  /** Offset of the anchor from the canvas centre, in project pixels. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  /** Anchor within the element box, 0..1. */
  anchorX: number;
  anchorY: number;
  /** Fractions (0..1) removed from each source edge. */
  crop: Crop;
}

export interface Effects {
  brightness: number; // 100 = neutral
  contrast: number; // 100 = neutral
  saturation: number; // 100 = neutral
  blur: number; // px in project space
}

export interface AudioProps {
  volume: number; // 1 = unity, up to 2
  pan: number; // -1..1
  fadeIn: number;
  fadeOut: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 600 | 800;
  color: string;
  align: 'left' | 'center' | 'right';
  shadow: boolean;
  background: string | null;
}

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** Properties that can be animated with keyframes. */
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';

export interface Keyframe {
  /** Clip-local time (seconds from clip start). */
  t: number;
  v: number;
  /** Easing of the segment that starts at this keyframe. */
  ease: Easing;
}

export type Keyframes = Partial<Record<AnimProp, Keyframe[]>>;

export type TransitionType = 'fade' | 'dissolve' | 'slide' | 'zoom';
export type Direction = 'left' | 'right' | 'up' | 'down';

/** A transition from the previous adjacent clip into this one, centred on the cut. */
export interface Transition {
  type: TransitionType;
  duration: number;
  direction: Direction;
  easing: Easing;
}

interface ClipBase {
  id: string;
  trackId: string;
  /** Timeline start. */
  start: number;
  /** Timeline duration. */
  duration: number;
  keyframes?: Keyframes;
  transitionIn?: Transition;
}

export interface MediaClip extends ClipBase {
  type: 'media';
  assetId: string;
  /** Source in-point. */
  in: number;
  speed: number;
  transform: Transform;
  effects: Effects;
  audio: AudioProps;
}

export interface TextClip extends ClipBase {
  type: 'text';
  text: string;
  style: TextStyle;
  transform: Transform;
  effects: Effects;
}

export type Clip = MediaClip | TextClip;

export type AspectPreset = '16:9' | '9:16' | '1:1' | '4:5' | '4:3';

export interface ProjectSettings {
  name: string;
  aspect: AspectPreset;
  /** Short edge in pixels (720 / 1080). */
  resolution: 720 | 1080;
  fps: 24 | 25 | 30 | 60;
  background: string;
}

export interface Project {
  settings: ProjectSettings;
  /** Index 0 is the top row in the timeline (and the top-most visual layer). */
  tracks: Track[];
  clips: Record<string, Clip>;
}
