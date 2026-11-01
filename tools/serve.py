"""
tools/serve.py — 本地开发服务器（替代 python -m http.server）

为什么要用它：
    python -m http.server 不发送任何缓存头，浏览器会按"启发式规则"把 .js/.css
    缓存起来，改完文件刷新仍然跑旧代码（非常迷惑）。
    这个脚本给所有响应加上 "Cache-Control: no-store"，
    改完代码刷新一次就生效，不用按 Ctrl+F5。

用法（在项目根目录下执行）：
    py -3 tools/serve.py            # 默认 http://127.0.0.1:8130/
    py -3 tools/serve.py 8080       # 换端口
    py -3 tools/serve.py 8130 192.168.1.5   # 换绑定地址（默认只绑定本机）

按 Ctrl+C 停止。
"""

import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8130
HOST = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """在默认静态文件服务上加两层：不走缓存 + 不打印每个请求（保持终端干净）。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # noqa: D401
        # 只记录错误，避免刷屏
        code = args[1] if len(args) > 1 else ""
        if str(code).startswith(("4", "5")):
            super().log_message(fmt, *args)


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ReusableServer((HOST, PORT), NoCacheHandler) as httpd:
        print(f"K线过山车 开发服务器已启动： http://{HOST}:{PORT}/")
        print(f"根目录：{ROOT}")
        print("（所有响应禁用缓存，改完代码刷新即可生效；Ctrl+C 停止）")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")
