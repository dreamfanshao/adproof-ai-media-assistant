from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    overview_response = page.request.get("http://127.0.0.1:3081/api/analytics/overview")
    if not overview_response.ok:
        raise AssertionError(f"统计接口返回 {overview_response.status}")
    overview = overview_response.json()["data"]
    expected_rate = "—" if overview["creatorSelectionRate"] is None else f'{overview["creatorSelectionRate"]}%'
    expected_detail = (
        f'已选 {overview["selectedCreators"]} ÷ 检索 {overview["retrievedCreators"]}'
        if overview["retrievedCreators"]
        else "暂无已进入候选池的达人"
    )
    page.goto("http://127.0.0.1:3081/admin", wait_until="networkidle")
    frame = page.frame(url=lambda url: "/workspace/admin" in url)
    if frame is None:
        raise AssertionError("后台管理 iframe 未加载")
    frame.locator("#adminKpis").wait_for(state="visible")
    north_star = frame.locator(".admin-north-star")
    north_star.wait_for(state="visible")
    text = north_star.inner_text()
    for expected in ["北极星指标", "已选达人转化率", expected_rate, expected_detail]:
        if expected not in text:
            raise AssertionError(f"北极星指标缺少内容：{expected}\n实际内容：\n{text}")
    print("NORTH_STAR_UI_OK")
    print(text)
    browser.close()
