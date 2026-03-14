export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown";

type MicManagerState = {
  stream: MediaStream | null;
  streamPromise: Promise<MediaStream> | null;
  idleTimer: number | null;
  idleMs: number;
};

const key = "__openclaw_hub_mic_manager__" as const;

function getState(): MicManagerState {
  const g = globalThis as any;
  if (!g[key]) {
    g[key] = {
      stream: null,
      streamPromise: null,
      idleTimer: null,
      idleMs: Number(process.env.NEXT_PUBLIC_HUB_MIC_IDLE_MS ?? 15_000),
    } satisfies MicManagerState;
  }
  return g[key] as MicManagerState;
}

function clearIdleTimer(s: MicManagerState) {
  if (s.idleTimer) {
    window.clearTimeout(s.idleTimer);
    s.idleTimer = null;
  }
}

function scheduleStop(s: MicManagerState) {
  clearIdleTimer(s);
  s.idleTimer = window.setTimeout(() => {
    try {
      stop();
    } catch {
      // ignore
    }
  }, s.idleMs);
}

export async function getMicPermissionState(): Promise<MicPermissionState> {
  try {
    const perms = (navigator as any).permissions;
    if (!perms?.query) return "unknown";
    const status = await perms.query({ name: "microphone" });
    const state = status?.state;
    if (state === "granted" || state === "denied" || state === "prompt") return state;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function acquireStream(): Promise<MediaStream> {
  const s = getState();

  // If we already have a live stream, reuse it.
  if (s.stream) {
    clearIdleTimer(s);
    for (const t of s.stream.getTracks()) t.enabled = true;
    return s.stream;
  }

  // If there is an in-flight request, await it.
  if (s.streamPromise) {
    const stream = await s.streamPromise;
    clearIdleTimer(s);
    for (const t of stream.getTracks()) t.enabled = true;
    return stream;
  }

  if (!window.isSecureContext) {
    throw new Error("Microphone requires HTTPS (secure context)");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone not supported in this browser");
  }

  s.streamPromise = navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      s.stream = stream;
      return stream;
    })
    .finally(() => {
      s.streamPromise = null;
    });

  const stream = await s.streamPromise;
  clearIdleTimer(s);
  for (const t of stream.getTracks()) t.enabled = true;
  return stream;
}

// Call when you are done recording/transcribing.
// For privacy, we disable tracks immediately, then fully stop shortly after.
export function release(): void {
  const s = getState();
  if (!s.stream) return;
  for (const t of s.stream.getTracks()) t.enabled = false;
  scheduleStop(s);
}

export function stop(): void {
  const s = getState();
  clearIdleTimer(s);
  for (const t of s.stream?.getTracks?.() ?? []) t.stop();
  s.stream = null;
}
