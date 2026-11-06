#!/usr/bin/env python3
"""
Smoke test: boot screen → Start the Machine → 16-row matrix renders.
Run via:  python3 with_server.py --server "npm run dev" --port 5173 -- python3 smoke_test.py
"""
from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout
import sys, pathlib, time

SCREENSHOTS = pathlib.Path("smoke_screenshots")
SCREENSHOTS.mkdir(exist_ok=True)

def run():
    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()

        # 1. Load page ----------------------------------------------------------
        print("[1] Navigating to http://localhost:5173 ...")
        page.goto("http://localhost:5173", wait_until="networkidle", timeout=30_000)
        page.screenshot(path=str(SCREENSHOTS / "01-initial-load.png"))
        print("    screenshot: 01-initial-load.png")

        # 2. Boot overlay -------------------------------------------------------
        print("[2] Looking for boot overlay …")
        boot_card = page.locator(".boot-card")
        try:
            boot_card.wait_for(state="visible", timeout=5_000)
            print("    ✓ .boot-card is visible")
        except PwTimeout:
            print("    ⚠ .boot-card not visible (engine may have auto-started)")

        # 3. Click "Start the Machine" or "Retry" if present --------------------
        start_btn = page.locator(".boot-card button.btn-primary")
        if start_btn.count() > 0 and start_btn.first.is_visible():
            print("[3] Clicking 'Start the Machine' …")
            start_btn.first.click()
        else:
            print("[3] No start button visible (already booted?)")

        # 4. Wait for matrix to appear (or timeout) -----------------------------
        print("[4] Waiting for .matrix …")
        matrix = page.locator(".matrix")
        try:
            matrix.wait_for(state="visible", timeout=15_000)
            print("    ✓ .matrix is visible")
        except PwTimeout:
            print("    ✗ .matrix never appeared — engine likely didn't init (headless WebAudio)")
            page.screenshot(path=str(SCREENSHOTS / "04-no-matrix.png"))
            browser.close()
            return False

        time.sleep(0.5)
        page.screenshot(path=str(SCREENSHOTS / "02-matrix-loaded.png"))
        print("    screenshot: 02-matrix-loaded.png")

        # 5. Count matrix rows --------------------------------------------------
        rows = page.locator(".matrix-row")
        row_count = rows.count()
        print(f"[5] Matrix rows found: {row_count}")
        if row_count != 16:
            print(f"    ✗ Expected 16 rows, got {row_count}")
            ok = False
        else:
            print("    ✓ 16 rows ✓")

        # 6. Track chips --------------------------------------------------------
        chips = page.locator(".track-chip")
        chip_count = chips.count()
        print(f"[6] Track chips found: {chip_count}")
        if chip_count < 1:
            print("    ✗ No track chips")
            ok = False
        else:
            print(f"    ✓ {chip_count} track chip(s) ✓")

        # 7. Pattern toolbar selects --------------------------------------------
        length_sel = page.locator(".pattern-toolbar select").first
        res_sel = page.locator(".pattern-toolbar select").nth(1)
        print(f"[7] Length select value: {length_sel.input_value()}")
        print(f"    Resolution select value: {res_sel.input_value()}")

        # 8. Take final screenshot scrolled to matrix ---------------------------
        matrix.scroll_into_view_if_needed()
        time.sleep(0.2)
        page.screenshot(path=str(SCREENSHOTS / "03-matrix-final.png"))
        print("    screenshot: 03-matrix-final.png")

        browser.close()

    return ok

if __name__ == "__main__":
    passed = run()
    print()
    print("=" * 50)
    if passed:
        print("SMOKE TEST PASSED ✓")
    else:
        print("SMOKE TEST FAILED ✗")
    print("=" * 50)
    sys.exit(0 if passed else 1)
