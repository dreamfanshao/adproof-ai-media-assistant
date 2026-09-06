"""Mocked browser regression for the RedFox credential UI.

This script never calls RedFox or the real application API. It supplies an
in-browser Supabase session and intercepts every /api/v1 request.
"""

import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
APP_URL = os.environ.get("APP_URL", "http://127.0.0.1:5173")
SCREENSHOT_PATH = Path(os.environ.get("SCREENSHOT_PATH", str(Path(os.environ["TEMP"]) / "redfox-credential-ui.png")))
USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
FAKE_API_KEY = "redfox-ui-test-key-never-sent"


def read_env_value(name: str) -> str:
    for raw_line in (ROOT / ".env.local").read_text(encoding="utf-8").lstrip("\ufeff").splitlines():
        if raw_line.startswith(f"{name}="):
            return raw_line.split("=", 1)[1].strip()
    raise RuntimeError(f"{name} is missing from .env.local")


supabase_host = urlparse(read_env_value("VITE_SUPABASE_URL")).hostname or ""
storage_key = f"sb-{supabase_host.split('.')[0]}-auth-token"
expires_at = int(time.time()) + 3600
session = {
    "access_token": "mock-access-token",
    "token_type": "bearer",
    "expires_in": 3600,
    "expires_at": expires_at,
    "refresh_token": "mock-refresh-token",
    "user": {
        "id": USER_ID,
        "aud": "authenticated",
        "role": "authenticated",
        "email": "ui-test@example.invalid",
        "email_confirmed_at": "2026-08-31T00:00:00.000Z",
        "app_metadata": {"provider": "email", "providers": ["email"]},
        "user_metadata": {},
        "created_at": "2026-08-31T00:00:00.000Z",
        "updated_at": "2026-08-31T00:00:00.000Z",
    },
}

saved_keys: list[str] = []
external_redfox_requests: list[str] = []


def json_response(route: Route, body: dict, status: int = 200) -> None:
    route.fulfill(status=status, content_type="application/json", body=json.dumps(body, ensure_ascii=False))


def handle_api(route: Route) -> None:
    request = route.request
    path = urlparse(request.url).path
    method = request.method
    if path == "/api/v1/me":
        json_response(route, {"data": {"id": USER_ID, "email": "ui-test@example.invalid", "display_name": "UI 测试", "created_at": "2026-08-31T00:00:00.000Z", "updated_at": "2026-08-31T00:00:00.000Z"}})
    elif path == "/api/v1/projects" and method == "GET":
        json_response(route, {"data": [{"id": PROJECT_ID, "name": "医美素人博主", "product_name": "医美", "status": "active"}]})
    elif path == f"/api/v1/projects/{PROJECT_ID}/creators":
        json_response(route, {"data": []})
    elif path == f"/api/v1/projects/{PROJECT_ID}/search-tasks" and method == "GET":
        json_response(route, {"data": []})
    elif path == f"/api/v1/projects/{PROJECT_ID}/search-rules:parse" and method == "POST":
        json_response(route, {"data": {"hard_filters": {}, "semantic_conditions": [], "limit": 20, "ranking": []}})
    elif path == f"/api/v1/projects/{PROJECT_ID}/search-tasks" and method == "POST":
        json_response(route, {"data": {"id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}})
    elif path == "/api/v1/search-tasks/cccccccc-cccc-4ccc-8ccc-cccccccccccc":
        json_response(route, {"data": {"id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "project_id": PROJECT_ID, "status": "partial", "terminal": True, "target_count": 20, "progress": 100, "collected_count": 0, "persisted_count": 0, "duplicate_count": 0, "stage_counts": {}, "error_message": "RedFoxHub 积分余额不足，已保存检索位置；当前新增 0/20 人。"}})
    elif path == "/api/v1/redfox-credential" and method == "GET":
        json_response(route, {"data": {"configured": True, "source": "system", "fingerprint": None, "updated_at": None, "replaceable": True}})
    elif path == "/api/v1/redfox-credential" and method == "PUT":
        payload = request.post_data_json
        saved_keys.append(payload["api_key"])
        json_response(route, {"data": {"configured": True, "source": "user", "fingerprint": "A1B2C3D4E5", "updated_at": "2026-08-31T00:00:00.000Z", "replaceable": True}})
    else:
        json_response(route, {"error": {"code": "MOCK_ROUTE_MISSING", "message": f"Unhandled mock route: {method} {path}"}}, 500)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.add_init_script(
        f"localStorage.setItem({json.dumps(storage_key)}, {json.dumps(json.dumps(session))});"
        f"localStorage.setItem('adproof.activeProjectId', {json.dumps(PROJECT_ID)});"
    )
    page = context.new_page()
    page.on("request", lambda request: external_redfox_requests.append(request.url) if "redfox" in request.url.lower() and "/api/v1/" not in request.url else None)
    page.route("**/api/v1/**", handle_api)
    page.route("**/auth/v1/**", lambda route: json_response(route, {"user": session["user"]}))

    page.goto(f"{APP_URL}/creators")
    page.wait_for_load_state("networkidle")
    page.get_by_text("系统 Key", exact=True).wait_for()
    page.get_by_role("button", name="配置 API Key").click()
    api_key_input = page.get_by_label("API Key", exact=True)
    api_key_input.fill(FAKE_API_KEY)
    page.get_by_role("button", name="保存并替换").click()
    page.get_by_text("个人 Key · A1B2C3D4E5", exact=True).wait_for()
    assert saved_keys == [FAKE_API_KEY]

    page.get_by_role("button", name="开始检索").click()
    page.get_by_text("RedFoxHub 积分余额不足", exact=False).wait_for()
    page.locator(".credential-message__action").click()
    api_key_input.wait_for()
    assert api_key_input.input_value() == ""
    api_key_input.fill("another-ui-test-key-never-sent")
    page.get_by_role("button", name="关闭").click()
    page.get_by_role("button", name="更换 API Key").first.click()
    assert api_key_input.input_value() == ""
    page.get_by_role("button", name="关闭").click()

    page.screenshot(path=str(SCREENSHOT_PATH), full_page=True)
    assert external_redfox_requests == []
    print(json.dumps({"ok": True, "saved_key_calls": len(saved_keys), "external_redfox_requests": 0, "screenshot": str(SCREENSHOT_PATH)}, ensure_ascii=False))
    browser.close()
