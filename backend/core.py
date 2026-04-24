import os
import threading
import time

import cv2
import numpy as np
import pyvirtualcam


def _probe_duration_sec(cap: cv2.VideoCapture) -> float:
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    n = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if fps > 0 and n > 0:
        return max(n / fps, 0.05)
    return 60.0


class VirtualCamManager:
    def __init__(self):
        self.cam = None
        self.running = False
        self.thread = None
        self.image = None
        self.video_cap = None
        self.video_path = None
        self.video_path_owned = False
        self.lock = threading.Lock()
        self.device_name = ""
        self.output_fps = 30.0

        self.playback_time_sec = 0.0
        self.video_duration_sec = 0.0
        self.playback_speed = 1.0
        self.paused = True

        # ✅ JPEG缓存
        self._last_jpeg = None
        self._last_jpeg_time = 0
        self._jpeg_cache_interval = 0.1  # 10fps

    def _release_video_unlocked(self):
        if self.video_cap is not None:
            self.video_cap.release()
            self.video_cap = None

        p = self.video_path
        owned = self.video_path_owned
        if owned and p and os.path.isfile(p):
            try:
                os.unlink(p)
            except OSError:
                pass

        self.video_path = None
        self.video_path_owned = False
        self.video_duration_sec = 0.0

    def set_image(self, img):
        with self.lock:
            self._release_video_unlocked()
            self.image = img

    def set_video_path(self, path: str, owned=False):
        path = os.path.abspath(path.strip())

        if not os.path.isfile(path):
            return False, "文件不存在"

        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            return False, "无法打开视频"

        duration = _probe_duration_sec(cap)

        with self.lock:
            self._release_video_unlocked()
            self.video_cap = cap
            self.video_path = path
            self.video_path_owned = owned
            self.video_duration_sec = duration
            self.playback_time_sec = 0.0
            self.paused = False

        return True, "视频已加载"

    def seek(self, t: float):
        with self.lock:
            if self.video_cap is None:
                return False

            d = max(self.video_duration_sec, 1e-6)
            t = max(0.0, min(t, d - 1e-3))
            self.video_cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ret, frame = self.video_cap.read()
            if ret and frame is not None:
                self.image = frame
            self.playback_time_sec = t
            return True

    def set_playback(self, speed=None, paused=None):
        with self.lock:
            if speed is not None and speed in (1.0, 2.0, 3.0):
                self.playback_speed = speed
            if paused is not None:
                self.paused = paused

    def start(self, width=1280, height=720, fps=30):
        if self.running:
            return True, "已运行"

        if self.image is None:
            self.image = np.zeros((height, width, 3), dtype=np.uint8)

        try:
            self.cam = pyvirtualcam.Camera(
                width=width,
                height=height,
                fps=fps,
                device="Unity Video Capture"  # 👈 关键
            )
            self.device_name = self.cam.device
            self.output_fps = float(fps)
            self.running = True

            self.thread = threading.Thread(target=self._loop, daemon=True)
            self.thread.start()

            return True, f"已启动: {self.device_name}"

        except Exception as e:
            return False, str(e)

    def _loop(self):
        while self.running:
            with self.lock:
                cap = self.video_cap
                paused = self.paused
                speed = self.playback_speed
                out_fps = self.output_fps

            if cap is not None and not paused:
                # ✅ 顺序读帧（关键优化）
                ret, frame = cap.read()

                if ret and frame is not None:
                    with self.lock:
                        self.image = frame
                        self.playback_time_sec += (1.0 / out_fps) * speed
                else:
                    with self.lock:
                        self.paused = True

            with self.lock:
                img = self.image

            if img is None:
                img = np.zeros((720, 1280, 3), dtype=np.uint8)

            if self.cam:
                frame = cv2.resize(img, (self.cam.width, self.cam.height))
                frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                self.cam.send(frame)
                self.cam.sleep_until_next_frame()

    def stop(self):
        self.running = False
        if self.cam:
            self.cam.close()
            self.cam = None

    @property
    def is_running(self):
        return self.running

    def get_status_dict(self):
        with self.lock:
            return {
                "running": self.running,
                "device": self.device_name,
                "has_video": self.video_cap is not None,
                "position": round(self.playback_time_sec, 2),
                "duration": round(self.video_duration_sec, 2),
                "speed": self.playback_speed,
                "paused": self.paused,
            }

    def get_frame_jpeg_at_time(self, t: float, max_width=280, quality=50) -> bytes | None:
        with self.lock:
            path = self.video_path
            duration = max(self.video_duration_sec, 0.05)

        if not path or not os.path.isfile(path):
            return None

        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            return None
        try:
            t = max(0.0, min(t, duration - 1e-3))
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ret, frame = cap.read()
            if not ret or frame is None:
                return None
            h, w = frame.shape[:2]
            if w > max_width:
                nh = int(h * (max_width / w))
                frame = cv2.resize(frame, (max_width, nh), interpolation=cv2.INTER_AREA)
            ok, buf = cv2.imencode(
                ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality]
            )
            return buf.tobytes() if ok else None
        finally:
            cap.release()

    def get_preview_jpeg_bytes(self, quality=50):
        now = time.time()

        if self._last_jpeg and (now - self._last_jpeg_time) < self._jpeg_cache_interval:
            return self._last_jpeg

        with self.lock:
            frame = self.image.copy() if self.image is not None else np.zeros((720, 1280, 3), dtype=np.uint8)

        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])

        if not ok:
            return None

        self._last_jpeg = buf.tobytes()
        self._last_jpeg_time = now

        return self._last_jpeg