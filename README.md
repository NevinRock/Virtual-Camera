# 🚀 VirtualCam Companion

> 🎥 Turn local videos or images into a virtual webcam  
> Powered by Python + FastAPI + React + UnityCapture

---

## ⚠️ Disclaimer

This project is intended for **educational and experimental purposes only**.

It must NOT be used for:
- Fraud, impersonation, or deception
- Bypassing age, identity, or security verification systems
- Any activity that violates laws or platform policies
- By using this project, you agree to comply with all applicable laws and regulations.

Users are solely responsible for how they use this software.

The author disclaims all liability for any misuse or damages.

------

## ✨ Features

- 📷 Use local video/image as webcam input
- ⚡ FastAPI backend (high performance)
- 🌐 React + Vite frontend
- 🎮 Playback controls (seek, pause, speed)
- 🔌 Virtual camera via pyvirtualcam
- 🧠 Extensible (AI processing, face swap, etc.)

------

## 📁 Project Structure

```
virtual_cam/
├── backend/
│   ├── api_server.py   # FastAPI backend
│   └── core.py         # Virtual camera logic
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

------

## ⚙️ Requirements

- Python 3.9+
- Node.js 18+
- Windows (required for virtual camera driver)

------

# 🔧 Installation

------

## 🥇 1. Install Python dependencies

```
pip install fastapi uvicorn opencv-python numpy pyvirtualcam
```

------

## 🥇 2. Install UnityCapture (IMPORTANT)

This project relies on a virtual camera driver.

👉 Repository:
 UnityCapture

👉 Or open:
 https://github.com/NevinRock/UnityCapture

------

### 📥 Steps

1. Download the repository (ZIP or clone)
2. Go to:

```
Install/
```

1. Run:

```
Install.bat
```

------

### ⚠️ Important

- Run as **Administrator**
- Restart your computer after installation

------

### ✅ Verify installation

Run:

```
import pyvirtualcam

cam = pyvirtualcam.Camera(1280, 720, 30)
print(cam.device)
```

Expected output:

```
Unity Video Capture
```

------

## 🥇 3. Start backend

```
cd backend
python api_server.py
```

Server runs at:

```
http://127.0.0.1:5566
```

------

## 🥇 4. Start frontend

```
cd frontend
npm install
npm run dev
```

------

# 🎮 Usage

------

## 📷 1. Start virtual camera

Click:

```
Start Virtual Camera
```

------

## 🎬 2. Load video

You can:

- Click to select a file
- Drag & drop a file path

------

## 🎛️ 3. Control playback

- Seek timeline
- Pause / resume
- Adjust playback speed

------

## 🌐 4. Use in other apps

Select:

```
Unity Video Capture
```

in:

- Browser (WebRTC)
- OBS
- Video apps

------

# ⚠️ Notes

- This uses **DirectShow**, not all apps support it
- Some platforms may reject virtual cameras
- Performance depends on CPU/GPU and video resolution

------

# 🚀 Future Improvements

- Real-time face swapping
- GPU acceleration
- Better anti-detection camera simulation
- Multi-camera support

------

# 📄 License

MIT License