export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  /** Present mode is not built in v1 — this only tracks which frame (if any)
   *  the camera is currently parked on, so the shape survives into v2. */
  activeFrameId: string | null;
}

export interface CameraFrame {
  id: string;
  name: string;
  camera: Pick<CameraState, "x" | "y" | "zoom">;
  /** Present mode will cycle frames in this order. Not consumed by anything yet. */
  order: number;
}

export const DEFAULT_CAMERA: CameraState = {
  x: 0,
  y: 0,
  zoom: 1,
  activeFrameId: null,
};
