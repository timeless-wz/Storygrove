import os
import urllib.request

TARGET_DIR = r"D:\ai\AI-Novel-Writer-master\inkspires_frontend\cdn_assets\product_intro"
os.makedirs(TARGET_DIR, exist_ok=True)

urls = [
    "https://file.inkspires.cn/product_intro/ai_spirit.webp",
    "https://file.inkspires.cn/product_intro/book-analysis-material-library.webp",
    "https://file.inkspires.cn/product_intro/chapter_canvas_light.webp",
    "https://file.inkspires.cn/product_intro/data_stats.webp",
    "https://file.inkspires.cn/product_intro/intro_final.mp4",
    "https://file.inkspires.cn/product_intro/wiki_light.webp",
    "https://file.inkspires.cn/product_intro/workspace_light.webp"
]

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

for u in urls:
    name = u.split("/")[-1]
    save_path = os.path.join(TARGET_DIR, name)
    print(f"正在下载: {name} ...")
    try:
        req = urllib.request.Request(u, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            with open(save_path, "wb") as f:
                f.write(data)
            print(f"[OK] {name} ({len(data)} bytes)")
    except Exception as e:
        print(f"[ERR] {name}: {e}")

print("CDN 产品展示图/视频下载完成！")
