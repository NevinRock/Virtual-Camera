import asyncio
import base64
import os
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from core import VirtualCamManager

app = FastAPI()
cam = VirtualCamManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ================= 数据模型 =================

class ImagePayload(BaseModel):
    image: str


class SeekPayload(BaseModel):
    time: float


class PlaybackPayload(BaseModel):
    speed: float | None = None
    paused: bool | None = None


class VideoPathPayload(BaseModel):
    path: str


# ================= 工具 =================

def normalize_user_video_path(raw: str) -> str:
    s = raw.strip().strip('"').strip("'")
    if s.lower().startswith("file:"):
        p = urlparse(s)
        path = unquote(p.path or "")
        if os.name == "nt" and len(path) >= 3 and path[0] == "/" and path[2] == ":":
            path = path.lstrip("/")
        s = path
    return os.path.abspath(os.path.normpath(s))


VIDEO_EXT = {
    ".mp4",
    ".mkv",
    ".webm",
    ".mov",
    ".avi",
    ".m4v",
    ".wmv",
    ".flv",
    ".mpeg",
    ".mpg",
}


def _pick_video_file_dialog() -> str | None:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    patterns = " ".join(sorted("*" + ext for ext in VIDEO_EXT))
    filetypes = [
        ("视频文件", patterns),
        ("所有文件", "*.*"),
    ]
    try:
        p = filedialog.askopenfilename(
            title="选择视频文件",
            filetypes=filetypes,
        )
        return p or None
    finally:
        root.destroy()


# ================= API =================

@app.get("/api/ping")
def ping():
    return {"msg": "pong"}


@app.get("/api/status")
def status():
    return cam.get_status_dict()


@app.post("/api/start")
def start():
    ok, msg = cam.start()
    return {"ok": ok, "message": msg}


@app.post("/api/stop")
def stop():
    cam.stop()
    return {"ok": True}


@app.post("/api/set_image")
def set_image(data: ImagePayload):
    img_data = base64.b64decode(data.image)
    nparr = np.frombuffer(img_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return {"ok": False}

    cam.set_image(img)
    return {"ok": True}


# ❌ 已删除 upload_video（避免卡死）


@app.post("/api/load_video_path")
def load_video_path(p: VideoPathPayload):
    if not (p.path or "").strip():
        return {"ok": False, "message": "路径为空"}
    try:
        path = normalize_user_video_path(p.path)
    except Exception as e:
        return {"ok": False, "message": f"路径解析失败: {e}"}

    ok, msg = cam.set_video_path(path, owned=False)
    return {"ok": ok, "message": msg, "path": path if ok else ""}


@app.post("/api/native_pick_video")
async def native_pick_video():
    try:
        path = await asyncio.to_thread(_pick_video_file_dialog)
    except Exception as e:
        return {"ok": False, "message": f"无法打开系统文件选择器: {e}"}
    if not path:
        return {"ok": False, "message": "已取消选择"}

    ok, msg = cam.set_video_path(path, owned=False)
    return {"ok": ok, "message": msg}


@app.post("/api/seek")
def seek(p: SeekPayload):
    ok = cam.seek(max(0.0, p.time))
    return {"ok": ok}


@app.post("/api/playback")
def playback(p: PlaybackPayload):
    cam.set_playback(speed=p.speed, paused=p.paused)
    return {"ok": True}


@app.get("/api/frame_at")
def frame_at(time: float = 0):
    b = cam.get_frame_jpeg_at_time(time, quality=50)
    if not b:
        return Response(status_code=404)
    return Response(content=b, media_type="image/jpeg")


# ================= MJPEG（已优化） =================

@app.get("/api/live.mjpg")
def live_mjpeg():
    boundary = b"frame"

    def gen():
        while True:
            # 👇 降低质量
            chunk = cam.get_preview_jpeg_bytes(quality=50)

            if chunk:
                yield (
                    b"--" + boundary + b"\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + chunk + b"\r\n"
                )

            # 👇 降到 10fps
            time.sleep(1 / 10.0)

    return StreamingResponse(
        gen(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ================= 启动 =================

def main():
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5566, reload=False)


if __name__ == "__main__":
    main()