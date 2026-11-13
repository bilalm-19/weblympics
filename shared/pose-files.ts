// Where the camera's pose runtime and models come from. Normally from their
// public hosts (jsDelivr and Google's storage), the first time a player picks
// the camera. In local mode (`pnpm local`, `pnpm lan`; docs/local.md) this
// server serves them itself, so the camera works with no internet and the
// page may talk to nothing but this server.

export const MEDIAPIPE_VERSION = "1.0.1";

/** The models, by the file name they are saved and served under. */
export const POSE_MODELS = {
  pose: {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
  // archery reads the fingers of the drawing hand (opening it shoots)
  hand: {
    file: "hand_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  },
} as const;

/** The page's <meta name> that says this server serves the files, and under which path. */
export const LOCAL_POSE_META = "weblympics-pose-files";
/** The path this server serves them under in local mode: wasm/ and models/. */
export const LOCAL_POSE_PATH = "/pose";

export interface PoseSources {
  wasm: string;
  pose: string;
  hand: string;
}

/** The runtime folder and model URLs: this server's (origin + path) when given, else the public hosts. */
export function poseSources(local: { origin: string; path: string } | null): PoseSources {
  if (local) {
    const base = local.origin + local.path;
    return { wasm: `${base}/wasm`, pose: `${base}/models/${POSE_MODELS.pose.file}`, hand: `${base}/models/${POSE_MODELS.hand.file}` };
  }
  return {
    wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
    pose: POSE_MODELS.pose.url,
    hand: POSE_MODELS.hand.url,
  };
}
