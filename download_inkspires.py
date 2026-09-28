import os
import re
import sys
import urllib.request
import urllib.error
from urllib.parse import urljoin

# Set stdout/stderr encoding to utf-8 if supported
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE_URL = "https://inkspires.cn/"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "inkspires_frontend")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def download_file(url, local_path):
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            with open(local_path, "wb") as f:
                f.write(data)
            rel_p = os.path.relpath(local_path, OUTPUT_DIR)
            print(f"[OK] {rel_p}")
            return data
    except urllib.error.HTTPError as e:
        print(f"[FAIL {e.code}] {url}")
    except Exception as e:
        print(f"[ERR] {url}: {e}")
    return None

def main():
    print(f"目标目录: {os.path.abspath(OUTPUT_DIR)}\n")

    # 1. 抓取首页
    print(">>> 1. 下载首页 index.html ...")
    index_html_bytes = download_file(BASE_URL, os.path.join(OUTPUT_DIR, "index.html"))
    if not index_html_bytes:
        print("首页下载失败，退出。")
        return
    index_html = index_html_bytes.decode("utf-8", errors="ignore")

    # 2. 基础静态图标和 manifest
    common_assets = [
        "favicon.png",
        "manifest.json",
        "icons/favicon-96x96.png",
        "icons/web-app-manifest-192x192.png",
        "icons/web-app-manifest-512x512.png",
        "icons/apple-touch-icon.png"
    ]
    print("\n>>> 2. 下载基础图标与配置文件 ...")
    for asset in common_assets:
        download_file(urljoin(BASE_URL, asset), os.path.join(OUTPUT_DIR, asset))

    # 3. 提取 HTML 中的入口资源
    print("\n>>> 3. 下载入口 JS 与 CSS ...")
    script_srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', index_html)
    link_hrefs = re.findall(r'<link[^>]+href=["\']([^"\']+)["\']', index_html)

    all_assets = set()
    for s in script_srcs + link_hrefs:
        clean_s = s.strip()
        if "/assets/" in clean_s or clean_s.startswith("assets/"):
            path_part = clean_s.split("?")[0].lstrip("/")
            all_assets.add(path_part)

    main_js_content = ""
    for path in all_assets:
        data = download_file(urljoin(BASE_URL, path), os.path.join(OUTPUT_DIR, path))
        if path.endswith(".js") and "index-" in path and data:
            main_js_content = data.decode("utf-8", errors="ignore")

    # 4. 从入口 JS 中提取 Vite 的所有异步路由/组件 chunk
    print("\n>>> 4. 提取并下载所有 Vite 路由与组件 Chunk ...")
    chunk_matches = re.findall(r'assets/[a-zA-Z0-9_\-\.]+\.(?:js|css)', main_js_content)
    chunk_list = sorted(list(set(chunk_matches)))
    print(f"检测到 {len(chunk_list)} 个核心组件模块 Chunk：")

    for chunk in chunk_list:
        download_file(urljoin(BASE_URL, chunk), os.path.join(OUTPUT_DIR, chunk))

    print("\n" + "="*50)
    print(f"全部前端资源已成功保存到: {os.path.abspath(OUTPUT_DIR)}")
    print("可以在该目录下运行: python -m http.server 8080 进行预览")
    print("="*50)

if __name__ == "__main__":
    main()
