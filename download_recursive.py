import os
import re
import sys
import urllib.request
import urllib.error
from urllib.parse import urljoin

if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE_URL = "https://inkspires.cn/"
TARGET_DIR = r"D:\ai\AI-Novel-Writer-master\inkspires_frontend"

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
                    pass
    return found_assets

def download_file(rel_path):
    url = urljoin(BASE_URL, rel_path)
    local_path = os.path.join(TARGET_DIR, rel_path.replace("/", os.sep))
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            with open(local_path, "wb") as f:
                f.write(data)
            print(f"[OK 下载成功] {rel_path} ({len(data)} bytes)")
            return True
    except urllib.error.HTTPError as e:
        print(f"[FAIL {e.code}] {rel_path}")
    except Exception as e:
        print(f"[ERR 错误] {rel_path}: {e}")
    return False

def get_already_have():
    already_have = set()
    for root, dirs, files in os.walk(TARGET_DIR):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), TARGET_DIR).replace("\\", "/")
            already_have.add(rel)
    return already_have

def main():
    round_num = 1
    total_newly_downloaded = 0

    while True:
        print(f"\n--- 第 {round_num} 轮深度扫描 ---")
        found = scan_all_files()
        already_have = get_already_have()

        missing = []
        for item in found:
            clean_item = item.split("?")[0].split("#")[0].strip()
            if clean_item and clean_item not in already_have:
                missing.append(clean_item)

        missing = sorted(list(set(missing)))
        if not missing:
            print(">>> 扫描完毕：所有在 JS/CSS/HTML 中被引用的静态资源已 100% 全部下载！")
            break

        print(f"发现 {len(missing)} 个尚未下载的关联资源，开始补充下载：")
        new_downloads = 0
        for m in missing:
            if download_file(m):
                new_downloads += 1
                total_newly_downloaded += 1

        if new_downloads == 0:
            print("未能下载任何新文件（可能文件不存在于服务器），停止递归。")
            break
        round_num += 1

    print("\n" + "="*50)
    final_files = get_already_have()
    print(f"最终本地文件总数: {len(final_files)}")
    print(f"本次补充下载数量: {total_newly_downloaded}")
    print("="*50)

if __name__ == "__main__":
    main()
