"""Frame-by-frame capture of /render into an MP4.
usage: python scripts/render.py [run] [fps] [out.mp4]
Needs the dev server on :3000 and ffmpeg on PATH."""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

run = sys.argv[1] if len(sys.argv) > 1 else "600"
fps = int(sys.argv[2]) if len(sys.argv) > 2 else 30
out = sys.argv[3] if len(sys.argv) > 3 else f"renders/jev-{run}-{fps}fps.mp4"
W, H = 1800, 1200
frames = f"renders/frames-{run}"
shutil.rmtree(frames, ignore_errors=True); os.makedirs(frames)
t0 = time.time()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--force_high_performance_gpu"])
    pg = b.new_page(viewport={"width": W, "height": H})
    pg.goto(f"http://localhost:3000/render?run={run}&size={W}x{H}&capture=1", wait_until="networkidle")
    pg.wait_for_function("window.__render && document.fonts.ready")
    pg.wait_for_timeout(500)
    duration = pg.evaluate("window.__render.duration")
    n = int(duration * fps) + 1
    for i in range(n):
        pg.evaluate(f"window.__render.seek({i / fps})")
        pg.screenshot(path=f"{frames}/{i:05d}.jpg", type="jpeg", quality=93)
    b.close()
print(f"captured {n} frames in {time.time() - t0:.0f}s")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", f"{frames}/%05d.jpg",
                "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], check=True)
shutil.rmtree(frames, ignore_errors=True)
print("wrote", out, f"{os.path.getsize(out) / 1e6:.1f} MB")
