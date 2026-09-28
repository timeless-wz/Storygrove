import os
import re

p = r'D:\ai\AI-Novel-Writer-master\inkspires_frontend'
all_urls = set()

for r, d, fs in os.walk(p):
    for f in fs:
        if f.endswith(('.js', '.css', '.html')):
            file_path = os.path.join(r, f)
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as fp:
                content = fp.read()
                matches = re.findall(r'(?:https?:)?//file\.inkspires\.cn/[^\s"\'\)`]+', content)
                for m in matches:
                    all_urls.add(m)

print(f"共发现 {len(all_urls)} 个外部 CDN 资源引用：")
for u in sorted(all_urls):
    print(u)
