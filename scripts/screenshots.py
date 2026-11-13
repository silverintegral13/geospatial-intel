"""Take the five app screenshots for deck_assets/ (needs a running app and a local Chrome).

  streamlit run app/main.py --server.port 8765 &
  python scripts/screenshots.py
"""
from playwright.sync_api import sync_playwright

TABS = [("Gujarat districts", "districts"), ("Sanand villages", "villages"), ("Plot report", "plot_report"),
        ("Pulse", "pulse"), ("NBFC lab", "nbfc_lab")]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 1400, "height": 1000})
    page.goto("http://localhost:8765", wait_until="networkidle")
    page.wait_for_selector("text=BhoomiPulse", timeout=60000)
    for label, name in TABS:
        page.get_by_role("tab", name=label).click()
        page.wait_for_timeout(5000)
        page.screenshot(path=f"deck_assets/screenshot_{name}.png")
        print("saved", name)
    b.close()
