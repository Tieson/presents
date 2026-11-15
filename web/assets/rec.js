/* Recording in the browser, shared by the workshop (voice / video message) and the gift page
   (the unwrapping video). Everything stays on the device until the caller uploads the blob. */
(function () {
  const MR = window.MediaRecorder;
  const MIMES = {
    // MP4 (H.264 + AAC) first: it plays everywhere, iPhones included; WebM where the browser can't record MP4
    video: ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4"],
    audio: ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
  };
  const pickMime = kind => (MR ? MIMES[kind].find(m => MR.isTypeSupported(m)) || "" : "");
  const supported = kind => !!(MR && navigator.mediaDevices?.getUserMedia && pickMime(kind));

  const stopStream = s => s?.getTracks().forEach(t => t.stop());

  /** camera (+ microphone) stream; `camera` = a deviceId, or "user" / "environment" */
  async function open({ video = true, audio = true, camera = "user" } = {}) {
    const v = !video ? false : {
      width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 },
      ...(camera === "user" || camera === "environment" ? { facingMode: camera } : { deviceId: { exact: camera } })
    };
    return navigator.mediaDevices.getUserMedia({ video: v, audio: audio ? { echoCancellation: true, noiseSuppression: true } : false });
  }

  /** cameras the browser knows about (labels are filled in only after access was granted) */
  async function cameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput"); }
    catch { return []; }
  }
  const facingOf = stream => stream?.getVideoTracks()[0]?.getSettings?.().facingMode || "";

  /** Why getUserMedia failed, in words for a person */
  function explain(err, what = "kameře a mikrofonu") {
    const n = err?.name || "";
    if (n === "NotAllowedError" || n === "SecurityError") return `Přístup ke ${what} je zakázaný. Povol ho v prohlížeči (ikonka u adresy stránky) a zkus to znovu.`;
    if (n === "NotFoundError" || n === "OverconstrainedError") return "Nenašla se žádná kamera ani mikrofon.";
    if (n === "NotReadableError") return "Kameru nebo mikrofon právě používá jiná aplikace.";
    return "Nahrávání se nepodařilo spustit.";
  }

  /**
   * Draws whatever the <video> shows onto a canvas and records that, so the camera can be
   * switched in the middle of a recording (a MediaRecorder can't swap its video track).
   */
  function compose(videoEl, { width = 480, fps = 24 } = {}) {
    const cv = document.createElement("canvas");
    if (!cv.captureStream) return null;
    const ctx = cv.getContext("2d");
    let raf = 0, on = true, last = 0;
    const size = () => {
      const vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
      const w = Math.min(width, vw), h = Math.round(w * vh / vw / 2) * 2;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    };
    size();
    const draw = t => {
      if (!on) return;
      raf = requestAnimationFrame(draw);
      if (t - last < 1000 / fps - 4 || videoEl.readyState < 2) return;
      last = t;
      size();
      ctx.drawImage(videoEl, 0, 0, cv.width, cv.height);
    };
    raf = requestAnimationFrame(draw);
    return { stream: cv.captureStream(fps), stop() { on = false; cancelAnimationFrame(raf); } };
  }

  /**
   * Records `stream` for at most `maxSeconds`, keeping the result under `maxBytes`.
   * → { stop(), done: Promise<{ blob, duration, mime }> }; onTick(elapsedSeconds) fires a few times a second.
   */
  function record(stream, { kind = "video", maxSeconds = 30, maxBytes = 4 * 1024 * 1024, onTick } = {}) {
    const mime = pickMime(kind);
    const budget = Math.floor(maxBytes * 8 * .86 / maxSeconds);       // bits per second, with room for container overhead
    const audioBits = kind === "audio" ? Math.min(96000, budget) : 48000;
    const opts = { mimeType: mime, audioBitsPerSecond: audioBits };
    if (kind === "video") opts.videoBitsPerSecond = Math.max(150000, Math.min(1400000, budget - audioBits));
    const mr = new MR(stream, opts);
    const chunks = [];
    let t0 = 0, timer = 0, size = 0;
    const done = new Promise((resolve, reject) => {
      mr.ondataavailable = e => {
        if (!e.data?.size) return;
        chunks.push(e.data); size += e.data.size;
        if (size > maxBytes * .97 && mr.state === "recording") mr.stop();      // never hand back more than can be uploaded
      };
      mr.onerror = e => { clearInterval(timer); reject(e.error || new Error("recorder")); };
      mr.onstop = () => {
        clearInterval(timer);
        const duration = Math.min(maxSeconds, (performance.now() - t0) / 1000);
        resolve({ blob: new Blob(chunks, { type: mime.split(";")[0] }), duration: Math.round(duration * 10) / 10, mime: mime.split(";")[0] });
      };
    });
    mr.start(500);
    t0 = performance.now();
    timer = setInterval(() => {
      const el = (performance.now() - t0) / 1000;
      onTick?.(Math.min(el, maxSeconds));
      if (el >= maxSeconds && mr.state === "recording") mr.stop();
    }, 200);
    return { done, stop() { if (mr.state !== "inactive") mr.stop(); }, get recording() { return mr.state === "recording"; } };
  }

  /** length of a sound / video file in seconds (null when the browser can't tell) */
  function durationOf(blob, kind) {
    return new Promise(resolve => {
      const el = document.createElement(kind === "audio" ? "audio" : "video");
      const url = URL.createObjectURL(blob);
      const end = v => { URL.revokeObjectURL(url); resolve(Number.isFinite(v) && v > 0 ? v : null); };
      el.preload = "metadata"; el.muted = true;
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration)) return end(el.duration);
        el.ontimeupdate = () => { el.ontimeupdate = null; end(el.duration); };   // recordings without a length in the header
        el.currentTime = 1e7;
      };
      el.onerror = () => end(null);
      setTimeout(() => end(null), 8000);
      el.src = url;
    });
  }

  /** Browser recordings carry no length; seeking far ahead once makes the player show it */
  function fixLength(el) {
    el.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(el.duration)) return;
      const back = () => { el.removeEventListener("timeupdate", back); el.currentTime = 0; };
      el.addEventListener("timeupdate", back);
      el.currentTime = 1e7;
    }, { once: true });
  }

  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  window.XDrec = { supported, pickMime, open, cameras, facingOf, explain, compose, record, durationOf, fixLength, stopStream, clock };
})();
