import os
import re
import urllib.request
import urllib.error
from urllib.parse import urljoin

BASE_URL = "https://inkspires.cn/"
TARGET_DIR = r"D:\ai\AI-Novel-Writer-master\inkspires_frontend"
ASSETS_DIR = os.path.join(TARGET_DIR, "assets")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def scan_all_files():
    found_assets = set()
    asset_exts = r'\.(?:js|css|png|jpg|jpeg|svg|webp|gif|woff2?|ttf|eot|ico|json|mp3|mp4|wasm)'
    pattern1 = re.compile(r'["\'`](/(?:assets|icons)/[^"\'`]+?' + asset_exts + r')["\'`]', re.I)
    pattern2 = re.compile(r'["\'`](assets/[^"\'`]+?' + asset_exts + r')["\'`]', re.I)
    pattern3 = re.compile(r'url\([\'"]?([^()\'"]+?' + asset_exts + r')[\'"]?\)', re.I)

    for root, dirs, files in os.walk(TARGET_DIR):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in ['.js', '.css', '.html', '.json']:
                file_path = os.path.join(root, f)
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as fp:
                        content = fp.read()
                        for m in pattern1.findall(content):
                            found_assets.add(m.lstrip("/"))
                        for m in pattern2.findall(content):
                            found_assets.add(m.lstrip("/"))
                        for m in pattern3.findall(content):
                            if not m.startswith("http") and not m.startswith("data:"):
                                found_assets.add(m.lstrip("/"))
                except Exception as e:
                    print(f"Error reading {file_path}: {e}")
    return found_assets

def check_missing(found_assets):
    already_have = set()
    for root, dirs, files in os.walk(TARGET_DIR):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), TARGET_DIR).replace("\\", "/")
            already_have.add(rel)

    missing = []
    for item in found_assets:
        clean_item = item.split("?")[0].split("#")[0].strip()
        if clean_item and clean_item not in already_have:
            missing.append(clean_item)
    return missing, already_have

if __name__ == "__main__":
    found = scan_all_files()
    missing, already_have = check_missing(found)
    print(f"当前已下载文件数量: {len(already_have)}")
    print(f"代码中引用的资源总数: {len(found)}")
    print(f"尚未下载的文件数量: {len(missing)}")
    if missing:
        print("\n未下载的文件清单:")
        for m in sorted(missing):
            print(f"  - {m}")
    else:
        print("\n所有引用文件均已下载！")
