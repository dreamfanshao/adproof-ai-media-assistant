from pathlib import Path
import re
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3081"
ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "test-results"
RESULTS.mkdir(exist_ok=True)
MOJIBAKE = re.compile(r"[銆锛鏁浜鎰璇绾妫鍛鏈閫鎵鐢娴绉缁]")


def assert_clean(page, label: str) -> None:
    text = page.locator("body").inner_text()
    assert "???" not in text, f"{label}: visible question-mark corruption"
    assert not MOJIBAKE.search(text), f"{label}: visible mojibake"


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

    page.goto(BASE + "/", wait_until="networkidle")
    assert page.url.rstrip("/").endswith("/admin"), "root should redirect to current workspace"

    page.goto(BASE + "/planner/creators", wait_until="networkidle")
    assert_clean(page, "creator planner prompt")
    prompt = page.locator("#prompt").input_value()
    assert "RedFox" in prompt and "20 人" in prompt
    top_nav = page.locator("#globalTabs").inner_text()
    for label in ["Skills", "Tools", "Planner", "模型管理", "运营中心", "数据中心"]:
        assert label in top_nav, f"missing top navigation: {label}"

    page.get_by_role("button", name="必经 Skill").click()
    skill_cards = page.locator("[data-required]")
    assert skill_cards.count() == 13
    skill_text = page.locator("#panel").inner_text()
    assert "个人博主与机构识别" in skill_text
    assert "本人经历证据识别" in skill_text
    assert_clean(page, "creator planner skills")

    page.get_by_role("button", name="Tool 分组").click()
    tool_text = page.locator("#panel").inner_text()
    assert "RedFox 笔记搜索" in tool_text
    assert "读取检索会话" in tool_text
    assert "保存达人结果" in tool_text
    assert_clean(page, "creator planner tools")

    page.get_by_role("button", name="模型参数").click()
    assert page.locator("#provider").get_attribute("readonly") is not None
    assert page.locator("#model").get_attribute("readonly") is not None
    assert page.locator("#provider").input_value() == "deepseek"
    assert "生产 Planner 直接读取" in page.locator("#panel").inner_text()
    assert_clean(page, "creator planner model")

    page.get_by_role("button", name="执行空间预览").click()
    page.get_by_role("button", name="预览生产计划").click()
    page.locator("#previewResult").filter(has_text="production-runtime-manifest").wait_for(timeout=10000)
    preview_text = page.locator("#previewResult").inner_text()
    assert '"valid": true' in preview_text
    assert "console-c-" not in preview_text
    assert "creator_personal_account_assessment" in preview_text
    page.screenshot(path=str(RESULTS / "planner-creators-runtime.png"), full_page=True)

    page.goto(BASE + "/planner/audit", wait_until="networkidle")
    assert_clean(page, "audit planner prompt")
    page.get_by_role("button", name="必经 Skill").click()
    assert page.locator("[data-required]").count() == 10
    audit_skill_text = page.locator("#panel").inner_text()
    assert "宣传声明提取" in audit_skill_text
    assert "确定性风险下限保护" in audit_skill_text
    assert "合规改写建议" in audit_skill_text
    page.get_by_role("button", name="模型参数").click()
    audit_model_text = page.locator("#panel").inner_text()
    assert "确定性编排" in audit_model_text
    assert page.locator("#temperature").count() == 0
    page.get_by_role("button", name="执行空间预览").click()
    page.get_by_role("button", name="预览生产计划").click()
    page.locator("#previewResult").filter(has_text="production-runtime-manifest").wait_for(timeout=10000)
    assert '"valid": true' in page.locator("#previewResult").inner_text()
    page.screenshot(path=str(RESULTS / "planner-audit-runtime.png"), full_page=True)

    for path, label in [
        ("/admin/creators?focus=skills", "skills admin"),
        ("/admin/creators?focus=tools", "tools admin"),
        ("/models/creators", "model admin"),
        ("/ops/creators", "operations"),
        ("/catalog/creators", "catalog"),
        ("/agent/creators", "agent console"),
    ]:
        page.goto(BASE + path, wait_until="networkidle")
        assert_clean(page, label)
        text = page.locator("body").inner_text()
        assert "Rnote API" not in text, f"{label}: legacy provider label is visible"

    assert not console_errors, "browser console errors: " + " | ".join(console_errors)
    browser.close()

print("Planner UI runtime alignment checks passed")
