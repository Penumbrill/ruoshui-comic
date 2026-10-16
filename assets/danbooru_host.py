"""Run the unmodified ComfyUI plugin with desktop host/transport adapters.

Upstream code and writable resources live in works. No search, classification,
rating, favorites or semantic-search algorithm is implemented in this host.
"""
import asyncio
import base64
import importlib
import json
import os
from pathlib import Path
import re
import sys
import types
import urllib.error
import urllib.request

for stream in (sys.stdin, sys.stdout, sys.stderr):
    stream.reconfigure(encoding="utf-8", errors="replace")
protocol = sys.stdout
sys.stdout = sys.stderr  # Upstream diagnostics must not corrupt JSONL RPC.
root, endpoint, token = sys.argv[1:4]
os.chdir(root)
sys.path.insert(0, root)

import requests


def remote_request(self, method, url, **kwargs):
    # Only the desktop network adapter performs HTTPS. In particular, upstream
    # verify=False cannot disable certificate validation in this application.
    headers = dict(self.headers)
    headers.update(kwargs.get("headers") or {})
    params = kwargs.get("params")
    prepared = requests.Request(method, url, params=params, headers=headers,
                                data=kwargs.get("data"), json=kwargs.get("json")).prepare()
    payload = json.dumps({"url": prepared.url, "method": method,
                          "headers": dict(prepared.headers),
                          "body": base64.b64encode(prepared.body.encode() if isinstance(prepared.body, str)
                                                   else prepared.body or b"").decode()}).encode()
    request = urllib.request.Request(endpoint, data=payload,
                                     headers={"Content-Type": "application/json", "X-Plugin-Token": token})
    try:
        # Local RPC always bypasses the user's system proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(request, timeout=65) as response:
            result = json.load(response)
    except Exception as error:
        raise requests.ConnectionError("插件网络适配连接失败") from error
    if result.get("error"):
        raise requests.ConnectionError(result["error"])
    response = requests.Response()
    response.status_code = result["status"]
    response._content = base64.b64decode(result["body"])
    response.headers.update(result["headers"])
    response.url = prepared.url
    response.encoding = requests.utils.get_encoding_from_headers(response.headers)
    return response


requests.sessions.Session.request = remote_request


class Routes:
    def __init__(self):
        self.entries = []

    def register(self, method, route):
        def decorate(handler):
            pattern = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", route)
            self.entries.append((method, re.compile("^" + pattern + "$"), handler))
            return handler
        return decorate

    def get(self, route):
        return self.register("GET", route)

    def post(self, route):
        return self.register("POST", route)


routes = Routes()
server_module = types.ModuleType("server")
server_module.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes))
sys.modules["server"] = server_module
folder_module = types.ModuleType("folder_paths")
folder_module.get_user_directory = lambda: root
sys.modules["folder_paths"] = folder_module

sys.modules["favorites"] = importlib.import_module("py.favorites")
browser = importlib.import_module("py.danbooru_browser")
browser._ensure_cn_index()


def emit(data):
    protocol.write(json.dumps(data, ensure_ascii=False) + "\n")
    protocol.flush()


async def dispatch(message):
    try:
        if message['path'] == '/__desktop_refresh' and message['method'] == 'POST':
            # Refresh the upstream's transient search cache through the host;
            # search, rating, classification and pagination code remain intact.
            browser._search_cache.clear()
            with browser._fuzzy_cache_lock:
                browser._fuzzy_cache.clear()
            emit({'id': message['id'], 'status': 200,
                  'headers': {'Content-Type': 'application/json; charset=utf-8'},
                  'body': base64.b64encode(b'{"success":true}').decode()})
            return
        if message["path"] == "/__desktop_outputs" and message["method"] == "POST":
            body = message.get("body", {})
            values = await asyncio.to_thread(browser.DanbooruBrowser().browse,
                                              selection_data=body.get("selection_data", "{}"),
                                              exclude_tags=body.get("exclude_tags", ""),
                                              node_settings=body.get("node_settings", "{}"),
                                              _tag_fusion=body.get("_tag_fusion", "{}"))
            keys = ["all", "quality_meta", "count", "character", "series", "artist", "general", "unclassified"]
            emit({"id": message["id"], "status": 200,
                  "headers": {"Content-Type": "application/json; charset=utf-8"},
                  "body": base64.b64encode(json.dumps({"success": True, "outputs": dict(zip(keys, values[1:]))},
                                                       ensure_ascii=False).encode()).decode()})
            return
        for method, pattern, handler in routes.entries:
            match = pattern.fullmatch(message["path"])
            if method != message["method"] or not match:
                continue

            async def json_body():
                return message.get("body", {})

            request = types.SimpleNamespace(json=json_body, match_info=match.groupdict(),
                                            query=message.get("query", {}), headers={})
            response = await handler(request)
            emit({"id": message["id"], "status": response.status,
                  "headers": dict(response.headers),
                  "body": base64.b64encode(response.body or b"").decode()})
            return
        raise ValueError("原插件没有注册此接口：" + message["path"])
    except Exception as error:
        emit({"id": message["id"], "error": str(error)})


async def main():
    emit({"ready": True, "routes": len(routes.entries)})
    tasks = set()
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        task = asyncio.create_task(dispatch(json.loads(line)))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    if tasks:
        await asyncio.gather(*tasks)


asyncio.run(main())
