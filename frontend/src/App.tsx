import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:5566";

function parsePathFromDataTransfer(dt: DataTransfer): string | null {
  const uriLine = dt
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0];
  const plain = dt.getData("text/plain").trim();
  for (const raw of [uriLine, plain]) {
    if (!raw) continue;
    if (/^file:\/\//i.test(raw)) return raw;
    if (/^[a-zA-Z]:[\\/]/.test(raw)) return raw;
    if (/^\\\\[\w.-]+\\/.test(raw)) return raw;
  }
  return null;
}

type Status = {
  running: boolean;
  device: string;
  has_video: boolean;
  position: number;
  duration: number;
  speed: number;
  paused: boolean;
};

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function App() {
  const [statusText, setStatusText] = useState("未连接");
  const [status, setStatus] = useState<Status | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const dragging = useRef(false);
  const hoverRaf = useRef<number>(0);
  const lastPreviewT = useRef(-1);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/status`);
      const data = (await res.json()) as Status;
      setStatus(data);
      setStatusText(
        data.running
          ? `运行中${data.device ? ` · ${data.device}` : ""}`
          : "未启动"
      );
      if (!dragging.current && data.has_video && data.duration > 0) {
        setScrub((data.position / data.duration) * 100);
      }
    } catch {
      setStatusText("无法连接后端（请先启动 api_server）");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 200);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  const duration = status?.duration ?? 0;
  const hasVideo = status?.has_video ?? false;

  const updateHoverPreview = useCallback(
    (pct: number) => {
      if (!hasVideo || duration <= 0) {
        setPreviewUrl(null);
        return;
      }
      const t = (pct / 100) * duration;
      setPreviewTime(t);
      if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current);
      hoverRaf.current = requestAnimationFrame(() => {
        if (Math.abs(t - lastPreviewT.current) < 0.08) return;
        lastPreviewT.current = t;
        setPreviewUrl(`${API}/api/frame_at?time=${t.toFixed(3)}&_=${Date.now()}`);
      });
    },
    [hasVideo, duration]
  );

  useEffect(() => {
    return () => {
      if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current);
    };
  }, []);

  const toggleCam = async () => {
    try {
      if (status?.running) {
        await fetch(`${API}/api/stop`, { method: "POST" });
        setStatusText("已停止");
        setStreamKey((k) => k + 1);
        void refreshStatus();
        return;
      }
      const res = await fetch(`${API}/api/start`, { method: "POST" });
      const data = (await res.json()) as { message?: string };
      setStatusText(data.message ?? "已响应");
      setStreamKey((k) => k + 1);
      void refreshStatus();
    } catch {
      setStatusText("操作失败，请确认后端已启动");
    }
  };

  const uploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      await fetch(`${API}/api/set_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });
      setStreamKey((k) => k + 1);
      void refreshStatus();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const applyPathLoadResult = (data: { ok?: boolean; message?: string }) => {
    setStatusText(data.message ?? (data.ok ? "已加载" : "加载失败"));
    setStreamKey((k) => k + 1);
    void refreshStatus();
  };

  const loadVideoFromPathWithString = async (path: string) => {
    const p = path.trim();
    if (!p) {
      setStatusText("请先填写本机视频文件的完整路径");
      return;
    }
    setStatusText("正在从本机路径加载…");
    try {
      const res = await fetch(`${API}/api/load_video_path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const raw = await res.text();
      let data: { ok?: boolean; message?: string } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        setStatusText(`加载失败（HTTP ${res.status}）`);
        return;
      }
      applyPathLoadResult(data);
    } catch {
      setStatusText("无法连接后端");
    }
  };

  const pickVideoFile = async () => {
    setStatusText("请在系统对话框中选择视频文件…");
    try {
      const res = await fetch(`${API}/api/native_pick_video`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      applyPathLoadResult(data);
    } catch {
      setStatusText("无法连接后端，或当前环境不支持系统文件对话框");
    }
  };

  const onDropZoneDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOver(false);

    const fromText = parsePathFromDataTransfer(e.dataTransfer);
    if (fromText) {
      await loadVideoFromPathWithString(fromText);
      return;
    }
    await pickVideoFile();
  };

  const seekFromPct = async (pct: number) => {
    if (!hasVideo || duration <= 0) return;
    const t = (pct / 100) * duration;
    await fetch(`${API}/api/seek`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: t }),
    });
    void refreshStatus();
  };

  const setSpeed = async (speed: number) => {
    await fetch(`${API}/api/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speed }),
    });
    void refreshStatus();
  };

  const togglePause = async () => {
    await fetch(`${API}/api/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: !status?.paused }),
    });
    void refreshStatus();
  };

  const pos = status?.position ?? 0;
  const spd = status?.speed ?? 1;
  const paused = status?.paused ?? true;

  return (
    <div className="vc">
      <header className="vc-header">
        <div className="vc-brand">
          <span className="vc-logo" aria-hidden />
          <div>
            <h1 className="vc-title">Virtual Cam</h1>
            <p className="vc-sub">与虚拟摄像头画面同步的预览与控制</p>
          </div>
        </div>
        <div className={`vc-pill ${status?.running ? "vc-pill-on" : ""}`}>
          {statusText}
        </div>
      </header>

      <section className="vc-stage">
        <div className="vc-frame">
          <img
            key={streamKey}
            className="vc-live"
            src={`${API}/api/live.mjpg`}
            alt="与虚拟摄像头同步的画面"
          />
          <div className="vc-frame-corner" />
        </div>

        {hasVideo && (
          <div className="vc-transport">
            <div className="vc-time">
              <span>{formatTime(pos)}</span>
              <span className="vc-time-sep">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            <div
              className="vc-track-wrap"
              onMouseMove={(e) => {
                const el = e.currentTarget;
                const r = el.getBoundingClientRect();
                const pct = Math.min(
                  100,
                  Math.max(0, ((e.clientX - r.left) / r.width) * 100)
                );
                setHoverPct(pct);
                updateHoverPreview(pct);
              }}
              onMouseLeave={() => {
                if (dragging.current) return;
                setHoverPct(null);
                setPreviewUrl(null);
                lastPreviewT.current = -1;
              }}
            >
              {hoverPct !== null && previewUrl && (
                <div
                  className="vc-scrub-preview"
                  style={{ left: `${hoverPct}%` }}
                >
                  <img src={previewUrl} alt="" />
                  <span className="vc-scrub-preview-cap">
                    {formatTime(previewTime)}
                  </span>
                </div>
              )}
              <input
                type="range"
                className="vc-range"
                style={{ "--fill": `${scrub}%` } as React.CSSProperties}
                min={0}
                max={100}
                step={0.05}
                value={scrub}
                disabled={!hasVideo || duration <= 0}
                onMouseDown={() => {
                  dragging.current = true;
                }}
                onMouseUp={() => {
                  dragging.current = false;
                  void seekFromPct(scrub);
                  setHoverPct(null);
                  setPreviewUrl(null);
                  lastPreviewT.current = -1;
                }}
                onTouchStart={() => {
                  dragging.current = true;
                }}
                onTouchEnd={() => {
                  dragging.current = false;
                  void seekFromPct(scrub);
                  setHoverPct(null);
                  setPreviewUrl(null);
                  lastPreviewT.current = -1;
                }}
                onInput={(e) => {
                  const v = Number(e.currentTarget.value);
                  setScrub(v);
                  setHoverPct(v);
                  updateHoverPreview(v);
                }}
                onChange={(e) => {
                  setScrub(Number(e.target.value));
                }}
              />
            </div>

            <div className="vc-controls">
              <button type="button" className="vc-btn vc-btn-primary" onClick={() => void togglePause()}>
                {paused ? "播放" : "暂停"}
              </button>
              <div className="vc-speed">
                <span className="vc-speed-label">倍速</span>
                {([1, 2, 3] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`vc-chip ${Math.round(spd) === s ? "vc-chip-active" : ""}`}
                    onClick={() => void setSpeed(s)}
                  >
                    ×{s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!hasVideo && (
          <p className="vc-hint">点击下方区域用系统对话框选择视频后，即可使用进度条、倍速（×2 / ×3）与悬停预览。</p>
        )}
      </section>

      <section className="vc-panel">
        <h2 className="vc-h2">设备</h2>
        <div className="vc-actions">
          <button
            type="button"
            className={`vc-btn-toggle ${status?.running ? "vc-btn-toggle-off" : "vc-btn-toggle-on"}`}
            onClick={() => void toggleCam()}
          >
            {status?.running ? "停止" : "启动虚拟摄像头"}
          </button>
        </div>

        <h2 className="vc-h2">视频</h2>
        <div
          className={`vc-dropzone ${dropOver ? "vc-dropzone--over" : ""}`}
          onClick={() => void pickVideoFile()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void pickVideoFile();
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDropOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            const rel = e.relatedTarget as Node | null;
            if (rel && e.currentTarget.contains(rel)) return;
            setDropOver(false);
          }}
          onDrop={(e) => void onDropZoneDrop(e)}
          role="button"
          tabIndex={0}
          aria-label="点击选择视频文件，或拖拽路径到这里"
        >
          <div className="vc-dropzone-icon" aria-hidden>
            <span className="vc-dropzone-arrow">↑</span>
          </div>
          <p className="vc-dropzone-title">点击或拖拽视频到这里</p>
          <p className="vc-dropzone-sub">
            点击会打开系统「打开文件」对话框，可进入任意文件夹并选择视频；拖拽时若能解析到本机路径也会直接加载。
          </p>
        </div>

        <h2 className="vc-h2">静态图</h2>
        <div className="vc-uploads">
          <label className="vc-file vc-file-secondary">
            <input type="file" accept="image/*" onChange={(e) => void uploadImage(e)} hidden />
            <span className="vc-file-inner">选择图片</span>
          </label>
        </div>
      </section>
    </div>
  );
}
