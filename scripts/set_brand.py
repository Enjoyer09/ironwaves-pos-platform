#!/usr/bin/env python3
"""Apply a brand profile (brand/<id>.json) to all app-identity touchpoints.

Usage: set_brand.py <profile>        e.g. set_brand.py emalatcoffee
       set_brand.py default          switch back to iRonWaves Loyalty

Rewrites (idempotent regex replaces):
  capacitor.config.ts        appId / appName
  ios .../project.pbxproj    PRODUCT_BUNDLE_IDENTIFIER
  ios .../Info.plist         CFBundleDisplayName
  android/app/build.gradle   namespace / applicationId
  android strings.xml        app_name, title_activity_main, package_name, custom_url_scheme
  customer.html              <title>
Then regenerates icons/splash via scripts/gen_icons.py <profile>.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable


def sub(path, pattern, repl, count=0, flags=re.S):
    p = os.path.join(ROOT, path)
    with open(p, encoding="utf-8") as f:
        text = f.read()
    new, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n == 0:
        print(f"  !! no match in {path}: {pattern!r}")
        return False
    with open(p, "w", encoding="utf-8") as f:
        f.write(new)
    print(f"  ok {path} ({n} replacement(s))")
    return True


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    profile = sys.argv[1]
    cfg_path = os.path.join(ROOT, "brand", profile + ".json")
    if not os.path.exists(cfg_path):
        print(f"unknown profile: {profile} (expected {cfg_path})")
        sys.exit(2)
    with open(cfg_path, encoding="utf-8") as f:
        b = json.load(f)
    app_id, app_name = b["appId"], b["appName"]
    title = b.get("displayTitle", app_name)
    print(f"applying profile '{profile}': {app_name} / {app_id}")

    ok = True
    # Capacitor config
    ok &= sub("capacitor.config.ts", r"appId: '[^']*'", f"appId: '{app_id}'")
    ok &= sub("capacitor.config.ts", r"appName: '[^']*'", f"appName: '{app_name}'")
    # iOS
    ok &= sub(
        "ios/App/App.xcodeproj/project.pbxproj",
        r"PRODUCT_BUNDLE_IDENTIFIER = [^;]+;",
        f"PRODUCT_BUNDLE_IDENTIFIER = {app_id};",
        flags=0,
    )
    ok &= sub(
        "ios/App/App/Info.plist",
        r"(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)",
        rf"\g<1>{app_name}\g<2>",
    )
    # Android
    ok &= sub("android/app/build.gradle", r'namespace = "[^"]*"', f'namespace = "{app_id}"')
    ok &= sub("android/app/build.gradle", r'applicationId "[^"]*"', f'applicationId "{app_id}"')
    for key, val in (
        ("app_name", app_name),
        ("title_activity_main", app_name),
        ("package_name", app_id),
        ("custom_url_scheme", app_id),
    ):
        ok &= sub(
            "android/app/src/main/res/values/strings.xml",
            rf'(<string name="{key}">)[^<]*(</string>)',
            rf"\g<1>{val}\g<2>",
        )
    # Web fallback title (runtime overwrites from tenant branding)
    ok &= sub("customer.html", r"<title>[^<]*</title>", f"<title>{title}</title>")

    if not ok:
        print("ABORT: some targets not found; no icons regenerated.")
        sys.exit(1)

    # Icons / splash / notification icon
    r = subprocess.run([PY, os.path.join(ROOT, "scripts", "gen_icons.py"), profile])
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
