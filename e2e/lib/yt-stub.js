// A stand-in for https://www.youtube.com/iframe_api so the test browser can
// reach the "playing" state: the same API surface the app uses, no network.
// Served by the harness in place of the real script (see harness.mjs).
(() => {
  const PS = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const videoId = (id) => (typeof id === "object" && id ? id.videoId : id);
  const startAt = (id, start) => (typeof id === "object" && id && id.startSeconds ? id.startSeconds : start || 0);

  class Player {
    constructor(el, opts) {
      this.opts = opts || {};
      this.state = PS.UNSTARTED;
      this.t = 0;
      this.d = 0;
      this.vol = 80;
      this.iv = null;
      window.__ytStub = this;
      const host = typeof el === "string" ? document.getElementById(el) : el;
      if (host) {
        const div = document.createElement("div");
        div.style.cssText =
          "width:100%;height:100%;background:linear-gradient(135deg,#1b2a1f,#050806);color:#6f8a78;display:grid;place-items:center;font:12px monospace";
        div.textContent = "stub video";
        host.appendChild(div);
      }
      setTimeout(() => this.opts.events?.onReady?.({ target: this }), 30);
    }
    set(state) {
      this.state = state;
      this.opts.events?.onStateChange?.({ data: state, target: this });
    }
    tick() {
      clearInterval(this.iv);
      this.iv = setInterval(() => {
        if (this.state === PS.PLAYING) this.t = Math.min(this.d, this.t + 0.25);
      }, 250);
    }
    loadVideoById(id, start) {
      this.vid = videoId(id);
      this.t = startAt(id, start);
      this.d = 312;
      setTimeout(() => this.set(PS.PLAYING), 40);
      this.tick();
    }
    cueVideoById(id, start) {
      this.vid = videoId(id);
      this.t = startAt(id, start);
      this.d = 312;
      setTimeout(() => this.set(PS.CUED), 40);
    }
    playVideo() {
      this.d = this.d || 312;
      setTimeout(() => this.set(PS.PLAYING), 30);
      this.tick();
    }
    pauseVideo() {
      this.set(PS.PAUSED);
    }
    stopVideo() {
      this.set(PS.UNSTARTED);
    }
    seekTo(seconds) {
      this.t = seconds;
    }
    setVolume(volume) {
      this.vol = volume;
    }
    getVolume() {
      return this.vol;
    }
    getCurrentTime() {
      return this.t;
    }
    getDuration() {
      return this.d;
    }
    getPlayerState() {
      return this.state;
    }
    getVideoData() {
      return { video_id: this.vid };
    }
    destroy() {
      clearInterval(this.iv);
    }
  }

  window.YT = { Player, PlayerState: PS };
  if (typeof window.onYouTubeIframeAPIReady === "function") window.onYouTubeIframeAPIReady();
})();
