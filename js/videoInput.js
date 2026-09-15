// ============================================================
// videoInput.js — "Input Layer / VideoInput" box.
//
// Owns loading a user-selected video FILE into a <video> element via a
// local object URL. The file is never uploaded anywhere — the object
// URL only ever points at bytes already sitting in the browser's memory.
// ============================================================

import { CONFIG } from "./config.js";

export class VideoInput {
  constructor(videoEl) {
    this.video = videoEl;
    this.objectUrl = null;
  }

  /** Returns a friendly error string, or null if the file is acceptable. */
  static validate(file) {
    if (!file) return "❌ No file selected.";
    const nameOk = CONFIG.acceptedVideoExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
    const typeOk = !file.type || CONFIG.acceptedVideoTypes.includes(file.type);
    if (!nameOk && !typeOk) {
      return "❌ Unsupported file type. Please upload an MP4, MOV, or WebM video.";
    }
    return null;
  }

  /** Loads a local File into the <video> element. Resolves once metadata is ready. */
  async loadFile(file) {
    const err = VideoInput.validate(file);
    if (err) throw new Error(err);

    this.destroy(); // release any previous object URL
    this.objectUrl = URL.createObjectURL(file);
    this.video.src = this.objectUrl;
    this.video.muted = true;
    this.video.playsInline = true;

    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("❌ Could not decode this video file in the browser."));
      };
      const cleanup = () => {
        this.video.removeEventListener("loadedmetadata", onLoaded);
        this.video.removeEventListener("error", onError);
      };
      this.video.addEventListener("loadedmetadata", onLoaded);
      this.video.addEventListener("error", onError);
    });

    // Chrome sometimes reports Infinity duration for certain containers
    // until the file has been scanned once; the seek-to-huge-then-back
    // trick forces it to resolve the real duration.
    if (!isFinite(this.video.duration)) {
      await new Promise((resolve) => {
        const onSeeked = () => {
          this.video.removeEventListener("seeked", onSeeked);
          this.video.currentTime = 0;
          resolve();
        };
        this.video.addEventListener("seeked", onSeeked);
        try {
          this.video.currentTime = 1e10;
        } catch {
          resolve();
        }
      });
    }
  }

  destroy() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
