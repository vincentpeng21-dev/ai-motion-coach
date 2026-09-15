// ============================================================
// webcamInput.js — "Input Layer / WebcamInput" box.
//
// Owns getUserMedia lifecycle only. Knows nothing about pose detection,
// angles, or the state machine — it just hands a live <video> element
// to whoever asks.
// ============================================================

export class WebcamInput {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
  }

  /** Throws a DOMException (NotAllowedError / NotFoundError / …) on failure. */
  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error("getUserMedia unsupported");
      err.name = "NotSupportedError";
      throw err;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: "user" },
      audio: false,
    });

    this.video.srcObject = this.stream;
    await new Promise((resolve) => {
      this.video.onloadedmetadata = () => resolve();
    });
    await this.video.play();
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  get active() {
    return !!this.stream;
  }
}

export function mapCameraError(err) {
  switch (err.name) {
    case "NotSupportedError":
      return "❌ This browser doesn't support camera access (getUserMedia unavailable). Please use a recent version of Chrome, Edge, or Firefox.";
    case "NotAllowedError":
    case "SecurityError":
      return "❌ Camera permission was denied. Please allow camera access in your browser's site settings and reload.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "❌ No camera device was found. Please connect a webcam and try again.";
    case "NotReadableError":
      return "❌ The camera is already in use by another application.";
    case "OverconstrainedError":
      return "❌ No camera on this device satisfies the requested resolution.";
    default:
      return `❌ Could not access the camera (${err.name || "unknown error"}).`;
  }
}
