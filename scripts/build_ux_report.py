#!/usr/bin/env python3
"""Build the mobile UI/UX audit report as ONE portable HTML file.

Every number in this report comes from a measurement that was taken against the live
production app (super.ironwaves.store, 390x844, DPR 3) and is reproducible with
`scripts/customer_app_ux_audit.py`. Contrast figures marked "pixel-measured" were read off the
rendered screenshot with `scripts/pixel_contrast.py`, not from computed styles — that
distinction mattered: the computed-style pass produced four false positives.
"""

import base64
import io
import json
import re
from pathlib import Path

from PIL import Image

OUT = Path("outputs/customer-app-ux-audit")
HTML_OUT = Path("docs/customer-app-ux-audit.html")

audit = json.loads((OUT / "audit.json").read_text())
pix = json.loads((OUT / "pixel_contrast.json").read_text())


def shot_b64(path, width=900, quality=82):
    im = Image.open(path).convert("RGB")
    if im.width > width:
        im = im.resize((width, int(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


SHOT_PLAN = [
    ("tab-join", "00-join.png", "Qeydiyyat", "Tək ekran, tək hərəkət. Başlıq + razılaşma + bir düymə. Sürtünmə yoxdur, üfüqi daşma yoxdur."),
    ("tab-home", "tab-home.png", "Əsas", "Loyallıq kartı, balans, möhür zolağı, sürətli keçidlər, kateqoriya lentləri."),
    ("tab-menu", "tab-menu.png", "Menyu", "130 məhsul, iki sütunlu tor. Hər kartda ürək düyməsi və nişan var. Bu ekran auditin ən ağır nəticəsini verdi."),
    ("tab-offers", "tab-offers.png", "Təkliflər", "Boş vəziyyət. İki sətir boz mətn — ikisi də kontrast həddindən aşağı düşür."),
    ("tab-feedback", "tab-feedback.png", "Rəy", "Ulduz reytinqi (34×34, etiketsiz), çip seçimləri, sərbəst mətn sahəsi."),
    ("tab-profile", "tab-profile.png", "Profil", "Üzvlük kartı, statistika, parametrlər qrupu. Boz mətn sıxlığı ən yüksək olan ekran."),
    ("tab-profile-dark", "tab-profile_dark.png", "Profil — qaranlıq", "Eyni ekran qaranlıq temada. Bürünc nişanı burada həddi azca keçir."),
    ("vp-vp320", "vp-vp320.png", "320 px", "Kiçik telefon. Üfüqi daşma YOXDUR — bu, dizaynın güclü tərəfidir."),
]


def findings_html():
    rows = []
    F = [
        ("Yüksək", "Toxunma hədəfləri Apple/Google həddindən aşağı",
         "28×32 px ürək düyməsi × 130 (Menyu), 33×32 px dil düymələri, 34×34 px ulduzlar, 37×37 px QR.",
         "Apple 44×44, Google 48×48 tələb edir; 28×32 bunun ~60 %-dir. Ürək məhsul kartının İÇİNDƏDİR və kartın özü səbətə əlavə edir — barmaq ürəyi buraxanda kart tutulur və müştəri İSTƏMƏDƏN səbətə məhsul əlavə edir. Bu, yalnız rahatsızlıq deyil, səhv sifarişdir."),
        ("Yüksək", "Boz mətn şkalası kontrast həddinin altındadır (20 ölçülmüş pozuntu)",
         "Ölçülmüş: <code>rgba(22,18,14,.45)</code> = 3.02:1 · <code>.52</code> = 3.62:1 · <code>.55</code> = 4.10:1 · slate-500 <code>#8E8E93</code> = 3.26:1 · slate-400 <code>#94A3B8</code> = 2.56:1. WCAG AA kiçik mətn üçün 4.5:1 tələb edir.",
         "Bu rənglər body mətni, bölmə başlıqları və qiymət üçün işlənir. Günəşli terrasda telefona baxan müştəri həmin mətnləri oxuya bilmir. Ən çox zərər çəkən: Təkliflər boş vəziyyəti (2.99:1), Menyu alt başlığı (3.1:1), Profil parametr başlıqları (3.62:1)."),
        ("Yüksək", "«NEW» nişanı 130 məhsulun 110-da görünür",
         "<code>OrderTab.tsx:957</code>: <code>isHot ? 'HOT' : (iced|soyuq) ? 'ICED' : 'NEW'</code>. Üçüncü hal süzgəc deyil, <b>fallback</b>-dır. Canlı sayım: NEW=110, HOT=1, ICED=19.",
         "«Yeni» etiketi mənasını itirir — 110 məhsul eyni anda «yeni» ola bilməz. Müştəri nişanı oxumağı dayandırır, yeni məhsulu isə məhz bu nişanla tapmalı idi. Marketinq siqnalı sıfıra düşür."),
        ("Orta", "Məhsul fotoşəkili üzərindəki nişan oxunmur",
         "Nişan mətni <b>8 px</b>-dir və <code>emerald-600</code> rəngi orta boz foto üzərində <b>1.05:1</b> verir (hesablanmış). Brend narıncısı <code>#F48C24</code> ağ fon üzərində 2.44:1-dir.",
         "8 px həm çox kiçik, həm də fon dəyişdikcə (hər məhsulun öz şəkli) kontrastı təmin edilə bilmir. Nəticə: nişan oxunmur, sadəcə kartı çirkləndirir."),
        ("Orta", "iOS Safari sahəyə toxunanda səhifəni böyüdür",
         "Axtarış sahələri və rəy mətn sahəsi <b>13 px</b> şriftlədir (ölçülmüş). iOS 16 px-dən kiçik sahəyə fokus verəndə ~1.3× böyüdür və geri qaytarmır.",
         "Müştəri Menyuda axtarışa toxunur, ekran böyüyür və düzəlmir — səhifə «sındı» kimi görünür. Düzəliş tək CSS dəyəridir, təsiri isə bütün axtarış axınına yayılır."),
        ("Orta", "Ekran oxuyucusu üçün başlıq strukturu yoxdur",
         "Təkliflər / AI / Rəy / Profil ekranlarında <b>heç bir</b> başlıq elementi yoxdur. Əsas ekranda yalnız bir H2. Menyuda 1 H1 + <b>117 H3</b> (hər məhsul üçün bir H3).",
         "Başlıq naviqasiyası ilə gəzən istifadəçi cari ekranın adını eşitmir. Menyudakı 117 H3 isə naviqasiyanı faydasız edir — ekran oxuyucusu siyahısı 117 elementə çevrilir."),
        ("Orta", "Məhsul şəkilləri çoxdan yüklənir",
         "130 <code>&lt;img&gt;</code> üçün <code>loading=\"lazy\"</code> yoxdur (<code>OrderTab.tsx:981</code>). Səhifə hündürlüyü <b>18 813 px</b>, 130 şəkil də açılışda yüklənir.",
         "Mobil şəbəkədə Menyu açılışı uzun çəkir və data yeyir. Görünən ekranda 6 kart var, amma 130-u yüklənir."),
        ("Aşağı", "Etiketsiz ikon düymələri",
         "Rəydə 5 ulduz (34×34), Profildə günəş/ay keçidi (33×32), Əsas ekranda narıncı ox (46×46) — <code>aria-label</code> yoxdur.",
         "Ekran oxuyucusu sadəcə «düymə» oxuyur; ulduz reytinqi isə tamamilə istifadə edilə bilməz olur."),
        ("Aşağı", "Alt naviqasiyada ARIA semantikası səhvdir və 6 ekrandan yalnız 2-si görünür",
         "<code>&lt;nav&gt;</code> daxilində <code>role=tablist</code>/<code>role=tab</code> yoxdur, amma <code>aria-selected</code> işlədilir. Naviqasiya yalnız «Əsas» və «Menyu»nu göstərir.",
         "Təkliflər, AI, Rəy və Profil yalnız səhifə daxilindəki keçidlərdən tapılır. Yeni müştəri «Profil»i alt paneldə axtarır və tapmır."),
        ("Aşağı", "<code>/vite.svg</code> hər açılışda 404 verir",
         "<code>index.html:5</code> Vite şablonunun yer tutucusunu saxlayır. <code>customer.html:5</code> isə düzgün <code>/logo.jpg</code> işlədir. Yoxlanıldı: <code>/vite.svg → 404</code>, <code>/manifest.webmanifest → 200</code>.",
         "Brauzer konsolunda hər açılışda səhv görünür; favicon tenant brendinə qədər gec görünür."),
        ("Aşağı", "Məhsul adları Azərbaycan dilinə uyğun deyil",
         "Canlı menyuda: «laktossuz sud», «pankek», «simit», «çiyelek dondurma S», «aksesuar», «iced kofe».",
         "Interfeys tam AZ-dir, məhsul adları isə yarımçıq transliterasiyadır. Menyunun peşəkar görünüşünü zəiflədir."),
    ]
    for sev, title, what, impact in F:
        cls = {"Yüksək": "sev-hi", "Orta": "sev-mid", "Aşağı": "sev-lo"}[sev]
        rows.append(
            "<tr>"
            f'<td><span class="sev {cls}">{sev}</span></td>'
            f"<td><b>{title}</b></td>"
            f'<td class="what">{what}</td>'
            f'<td class="imp">{impact}</td>'
            "</tr>"
        )
    return "\n".join(rows)


def contrast_html():
    fails = [f for f in pix if f["fail"] and not f["low_confidence"]]
    fails.sort(key=lambda f: f["cr"])
    rows = []
    for f in fails:
        rows.append(
            "<tr>"
            f'<td><code>{f["screen"]}</code></td>'
            f'<td class="t">{f["t"]}</td>'
            f'<td class="n">{f["fs"]}px / {f["fw"]}</td>'
            f'<td class="n">{f["cr"]}:1</td>'
            f'<td class="n">{f["need"]}</td>'
            f'<td><code>rgb{f["glyph"]}</code> / <code>rgb{f["bg"]}</code></td>'
            f'<td><code>{f["cls"] or "—"}</code></td>'
            "</tr>"
        )
    return "\n".join(rows)


def touch_html():
    rows = []
    for tab in ("menu", "profile", "feedback", "home"):
        v = (audit.get("tabs") or {}).get(tab) or {}
        for t in v.get("targets44", [])[:8]:
            rows.append(
                "<tr>"
                f"<td><code>{tab}</code></td>"
                f'<td class="n">{t["w"]}×{t["h"]}</td>'
                f'<td class="n">{t.get("n", 1)}</td>'
                f'<td class="t">{t["t"]}</td>'
                f'<td><code>{(t.get("cls") or t.get("ctx") or "—")[:46]}</code></td>'
                "</tr>"
            )
    return "\n".join(rows)


def shots_html():
    parts = []
    for name, fname, title, cap in SHOT_PLAN:
        p = OUT / fname
        if not p.exists():
            continue
        parts.append(
            f'<figure class="shot"><img src="{shot_b64(p)}" alt="{title} ekranı" loading="lazy">'
            f'<figcaption><b>{title}</b><span>{cap}</span></figcaption></figure>'
        )
    return "\n".join(parts)


def perf_rows():
    rows = []
    for k in ("join", "home", "menu", "offers", "ai", "feedback", "profile",
              "home_dark", "profile_dark", "vp320", "vp360", "vp768"):
        v = (audit.get("tabs") or {}).get(k) if k not in ("join",) else audit.get("join_probe")
        if not v:
            continue
        n = v.get("navPad") or {}
        solid = len([c for c in v.get("contrast", []) if c.get("solid")])
        rows.append(
            "<tr>"
            f"<td><code>{k}</code></td>"
            f'<td class="n">{v["vw"]}×{n.get("vh", "—")}</td>'
            f'<td class="n">{v["docW"]}</td>'
            f'<td class="n">{"YOX" if not v["overflowX"] else str(v["overflowWide"]) + "px"}</td>'
            f'<td class="n">{v["h1"]}</td>'
            f'<td class="n">{len(v.get("targets24", []))}</td>'
            f'<td class="n">{sum(t.get("n", 1) for t in v.get("targets44", []))}</td>'
            f'<td class="n">{len(v.get("smallInputs", []))}</td>'
            f'<td class="n">{solid}</td>'
            f'<td class="n">{len(v.get("occluded", []))}</td>'
            "</tr>"
        )
    return "\n".join(rows)


def false_positives():
    return """
    <tr><td>Təbəqə şəffaflığı hesaba alınmırdı</td>
      <td>«Loyallıq kartındaki ağ mətn 1.12:1» — ilk ölçmə alfa kanalını kompozisiya etmirdi.</td>
      <td>Kart qaranlıq qradiyentdir; piksel ölçməsi <b>7.61:1</b> göstərdi. Bugünkü metod hər fonu ağ VƏ qara ekstremala qarşı yoxlayır — hər ikisində uğursuz olan mətn həqiqi pozuntudur.</td></tr>
    <tr><td>Səhv element ölçülürdü</td>
      <td>«Alt naviqasiya dil düyməsini kəsir» — sürüşmə testi naviqasiyanın ÖZ düyməsini seçirdi.</td>
      <td>Düzəldilmiş test (tam sürüşmə, naviqasiya alt ağacı çıxarılaraq): <b>0 kəsilmiş</b> element. Tapıntı ləğv edildi.</td></tr>
    <tr><td>Yanlış element seçilirdi</td>
      <td>«Menyu sona çatmır, 84 px qalır» — səbəb tənbəl yüklənən şəkillərin səhifəni böyütməsi idi.</td>
      <td>Təkrar sürüşmədən sonra <code>docH 18 813</code>, <code>atEnd = true</code>. Saxta tapıntı.</td></tr>
    <tr><td>«Görünməz mətn» şübhəsi</td>
      <td>«Bürünc nişanı 1:1 — ümumiyyətlə görünmür».</td>
      <td>Mətn rənginin alfası nəzərə alınmamışdı. İşıqlı temada keçir; qaranlıq temada <b>4.37:1</b> — həqiqi, lakin sərhəd pozuntusudur.</td></tr>
    <tr><td>Sınaq artefaktı</td>
      <td><code>h1</code> sayımı hər ekranda 0 verdi.</td>
      <td><code>tagName</code> BÖYÜK hərflədir; müqayisə registrə həssas idi. Düzəlişdən sonra Qeydiyyat və Menyu ekranlarında H1 tapıldı.</td></tr>
    """


# ── derived figures: the report must never quote a stale hand-typed number ──
CONF_WEAK = [f for f in pix if f.get("fail") and not f.get("low_confidence")]
N_CONF = len(CONF_WEAK)
N_COLLECTED = len(pix)
MENU = (audit.get("tabs") or {}).get("menu") or {}
N_MENU_44 = sum(t.get("n", 1) for t in MENU.get("targets44", []))
N_MENU_IMGS = MENU.get("imgCount", 0)
ALL_TABS = list((audit.get("tabs") or {}).values()) + [audit.get("join_probe") or {}]
N_MANDATORY = sum(len(v.get("targets24", [])) for v in ALL_TABS)
N_OVERFLOW = sum(1 for v in ALL_TABS if v.get("overflowX"))


def strengthen():
    return """
    <div class="strengths">
      <div class="sitem"><b>Üfüqi daşma sıfırdır</b><span>320, 360, 390 və 768 px-də <code>scrollWidth === innerWidth</code>. Dörd ölçüdə də. Bu, mobil dizaynda ən çox pozulan qaydadır və burada təmizdir.</span></div>
      <div class="sitem"><b>Məcburi toxunma həddi pozulmur</b><span>WCAG 2.2 SC 2.5.8 (24×24) üzrə <b>{{MANDATORY}}</b> pozuntu — bütün {{NSCREENS}} ekran/ölçüdə. Menyudaki {{MENU44}} tövsiyə var, məcburi pozuntu yoxdur. Bu fərqi ayırmaq vacibdir.</span></div>
      <div class="sitem"><b>Şəkillər əlçatandır</b><span>Menyudakı 130 <code>&lt;img&gt;</code>-in hamısında <code>alt</code> atributu var; dekorativ boş <code>alt</code> yoxdur.</span></div>
      <div class="sitem"><b>Loyallıq kartı kontrastı güclüdür</b><span>Piksel ölçməsi 7.61:1. Balans (34 px, qalın) kartın üzərində aydın oxunur — sərmayənin vurğulandığı yer düzgün seçilib.</span></div>
      <div class="sitem"><b>Alt naviqasiyanın ölçüsü rahatdır</b><span>Tab başına 117×52 px, QR düyməsi 48×48. Baş barmaq üçün düzgün.</span></div>
      <div class="sitem"><b>Sessiya düzgün bərpa olunur</b><span><code>?customer=1</code> ilə birbaşa giriş yoxlanıldı — sessiya tapıldı, ekran açıldı, PIN tələb olunmadı. Qeydiyyatdan sonrakı son vəziyyət düzgündür.</span></div>
    </div>
    """


CSS = """
:root{--ink:#0f0c09;--mut:#6b6460;--line:#e6e3df;--bg:#f7f6f4;--card:#fff;--acc:#b4541b;--hi:#b42318;--mid:#b54708;--lo:#475467}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
.wrap{max-width:1080px;margin:0 auto;padding:32px 20px 72px}
header.top{border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:26px}
.kicker{font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--acc)}
h1{font-size:clamp(26px,4.4vw,40px);line-height:1.1;letter-spacing:-.028em;margin:12px 0 8px}
.sub{color:var(--mut);font-size:15px;max-width:66ch}
h2{font-size:clamp(19px,2.4vw,25px);letter-spacing:-.02em;margin:44px 0 6px;padding-top:16px;border-top:1px solid var(--line)}
h3{font-size:16px;margin:26px 0 8px}
p{margin:10px 0}
code{font:500 12.5px/1.45 ui-monospace,Menlo,Consolas,monospace;background:#efece8;padding:2px 5px;border-radius:5px;color:#3d3733;word-break:break-word}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0 8px}
@media(max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 15px}
.kpi b{display:block;font-size:25px;line-height:1;letter-spacing:-.03em}
.kpi span{display:block;margin-top:7px;font:600 10px/1.35 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.kpi.bad b{color:var(--hi)} .kpi.ok b{color:#067647}
.tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:14px 0;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.tscroll table{margin:0}
table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:620px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font:700 10.5px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);background:#fbfaf9;white-space:nowrap}
tr:last-child td{border-bottom:0}
td.n{white-space:nowrap;font-variant-numeric:tabular-nums}
td.t{max-width:210px}
td.what{max-width:330px;font-size:13px;color:#3d3733}
td.imp{max-width:330px;font-size:13px}
.sev{display:inline-block;padding:3px 8px;border-radius:99px;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.sev-hi{background:#fee4e2;color:var(--hi)} .sev-mid{background:#fef0c7;color:var(--mid)} .sev-lo{background:#eaecef;color:var(--lo)}
.shot{display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start;margin:20px 0;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:16px}
.shot img{width:100%;height:auto;border-radius:10px;border:1px solid var(--line);display:block}
.shot figcaption{margin:0}
.shot figcaption b{display:block;font-size:15px;margin-bottom:6px}
.shot figcaption span{display:block;color:var(--mut);font-size:13.5px;line-height:1.6}
@media(max-width:820px){.shot{grid-template-columns:1fr}}
.strengths{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:16px 0}
@media(max-width:720px){.strengths{grid-template-columns:1fr}}
.sitem{background:var(--card);border:1px solid var(--line);border-left:3px solid #10b981;border-radius:12px;padding:13px 15px}
.sitem b{display:block;font-size:14px;margin-bottom:5px}
.sitem span{display:block;color:var(--mut);font-size:13px;line-height:1.6}
.note{background:#fffbf5;border:1px solid #f0e2cf;border-left:3px solid var(--acc);border-radius:12px;padding:14px 16px;margin:16px 0;font-size:13.5px}
.note b{display:block;margin-bottom:5px}
.callout{background:#f4f8f4;border:1px solid #d8e6d8;border-left:3px solid #067647;border-radius:12px;padding:14px 16px;margin:16px 0;font-size:13.5px}
ol.rec{list-style:none;counter-reset:r;padding:0;margin:16px 0}
ol.rec li{counter-increment:r;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px 14px 54px;position:relative;margin-bottom:10px;font-size:13.5px}
ol.rec li::before{content:counter(r);position:absolute;left:16px;top:14px;width:24px;height:24px;border-radius:7px;background:var(--ink);color:#fff;font:700 12px/24px ui-monospace,Menlo,monospace;text-align:center}
ol.rec li b{display:block;margin-bottom:4px;font-size:14px}
footer{margin-top:52px;padding-top:18px;border-top:1px solid var(--line);color:var(--mut);font-size:12.5px}
"""

HTML = """<!DOCTYPE html>
<html lang="az">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Customer App — mobil UI/UX auditi</title>
<style>{{CSS}}</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <div class="kicker">iRonWaves · Customer App · Mobil audit</div>
  <h1>Kritik müştəri tətbiqinin mobil UI/UX auditi</h1>
  <p class="sub">
    Hədəf: <b>super.ironwaves.store</b> (canlı istehsal) · iPhone 14/15 ölçüsü <b>390×844</b>, DPR 3 ·
    bütün tablar, işıqlı və qaranlıq tema, 320/360/390/768 px ölçüləri.
    Hər rəqəm canlı tətbiqdə ölçülüb və <code>scripts/customer_app_ux_audit.py</code> ilə təkrarlana bilər.
    Şəxsi müştəri məlumatlarına toxunulmadı: audit üçün bir müvəqqəti hesab açıldı və <code>delete-account</code> ilə silindi.
  </p>
  <div class="kpis">
    <div class="kpi ok"><b>0</b><span>Üfüqi daşma (4 ölçüdə)</span></div>
    <div class="kpi ok"><b>{{MANDATORY}}</b><span>WCAG 24×24 pozuntusu</span></div>
    <div class="kpi bad"><b>{{MENU44}}</b><span>Apple 44 həddindən aşağı (Menyu)</span></div>
    <div class="kpi bad"><b>{{NCONF}}</b><span>Piksel-təsdiqli kontrast pozuntusu</span></div>
    <div class="kpi bad"><b>110 / 130</b><span>Məhsulda «NEW» nişanı</span></div>
    <div class="kpi"><b>{{MENUIMG}}</b><span><code>loading=lazy</code> olmadan şəkil</span></div>
  </div>
</header>

<h2>1 · Güclü tərəflər — bunlar düzgündür</h2>
<p>
  Audit yalnız qüsurları sadalasa, ondan qərar çıxarmaq olmaz. Aşağıdakılar ölçülüb və
  <b>yaxşı</b> nəticə verib — bunlara toxunmaq lazım deyil.
</p>
{{STRENGTHS}}

<h2>2 · Vizual gəzinti</h2>
<p>Hər ekran canlı tətbiqdən çəkilib. İzahatda həmin ekranda ölçülən əsas rəqəm var.</p>
{{SHOTS}}

<h2>3 · Tapıntılar — nə baş verir və biznes üçün nə deməkdir</h2>
<p>
  Ciddiyyət üç səviyyədədir: <span class="sev sev-hi">Yüksək</span> sifariş itkisi və ya etibar,
  <span class="sev sev-mid">Orta</span> çaşqınlıq və oxuna bilmə,
  <span class="sev sev-lo">Aşağı</span> kosmetik və ya texniki.
  Toxunma düymələri üçün ayrıca qeyd: <b>WCAG 24×24 məcburidir, Apple/Google 44/48 tövsiyədir</b> —
  aşağıdaki cədvəldə {{MENU44}} rəqəmi <b>tövsiyə</b> pozuntusudur, məcburi deyil.
</p>
<div class="tscroll">
<table>
<thead><tr><th>Ciddiyyət</th><th>Tapıntı</th><th>Nə baş verir (ölçülmüş)</th><th>Müştəri üçün təsiri</th></tr></thead>
<tbody>
{{FINDINGS}}
</tbody>
</table>
</div>

<h2>4 · Kontrast — piksel üzərində təsdiqlənib</h2>
<p>
  Kontrast <b>hesablanmış CSS ilə deyil, ekran şəklindəki real piksellərlə</b> ölçülüb. Bu vacibdir:
  hesablanmış üsul qradiyent və şəffaf fonlarda yanılır. Hər mətn üçün fon = qutudakı ən çox təkrarlanan
  rəng, qlyf rəngi = fondan ən uzaq piksel. Cəmi <b>{{NCOLLECTED}}</b> mətn ölçüldü.
  Aşağıdakı <b>{{NCONF}}</b> sətir həm ağ, həm qara fon ekstremalına qarşı uğursuz olur — yəni fon nə
  olursa olsun oxunmur. Bu, «şübhəli» siyahıdan ayrıdır: qalan {{NUNC}} sətir aşağıdır, lakin fonu
  birdəfəlik təyin etmək mümkün olmadığından onlar tapıntı kimi yazılmır.
</p>
<div class="tscroll">
<table>
<thead><tr><th>Ekran</th><th>Mətn</th><th>Ölçü</th><th>Ölçülmüş</th><th>Tələb</th><th>Qlyf / fon</th><th>Sinif</th></tr></thead>
<tbody>
{{CONTRAST}}
</tbody>
</table>
</div>
<div class="note">
  <b>Şkalanın kökü bir yerdədir</b>
  <code>rgba(22,18,14,α)</code> ailəsi bütün boz mətn üçün işlənir. Hesablanmış keçid nöqtəsi:
  <b>α ≥ 0.58</b> ağ fonda 4.5:1 verir. Hazırda <code>.45</code> (3.02:1), <code>.52</code> (3.62:1) və
  <code>.55</code> (4.10:1) işlənir. Yəni düzəliş səpələnmiş deyil — <b>bir neçə CSS dəyəri</b>
  bütün 20 pozuntunun əksəriyyətini bağlayır.
</div>

<h2>5 · Toxunma hədəfləri</h2>
<p>
  Ölçmə etiketə görə aparılıb: 16 px checkbox böyük <code>&lt;label&gt;</code> içindədirsə, hədəf
  checkbox deyil, label-in ölçüsüdür. Bu qayda olmasa, 30 tövsiyəni 30 pozuntu kimi oxuyardıq.
</p>
<div class="tscroll">
<table>
<thead><tr><th>Ekran</th><th>Ölçü</th><th>Say</th><th>Element</th><th>Sinif</th></tr></thead>
<tbody>
{{TOUCH}}
</tbody>
</table>
</div>

<h2>6 · Ekran-ekran ölçmə cədvəli</h2>
<div class="tscroll">
<table>
<thead><tr>
<th>Ekran</th><th>Ölçü</th><th>docW</th><th>Üfüqi daşma</th><th>H1</th>
<th>&lt;24</th><th>&lt;44</th><th>&lt;16px sahə</th><th>Kontrast (həqiqi)</th><th>Naviqasiya kəsir</th>
</tr></thead>
<tbody>
{{PERF}}
</tbody>
</table>
</div>
<p style="font-size:13px;color:var(--mut)">
  <b>&lt;24</b> — məcburi WCAG pozuntusu. Bütün sətirlərdə <b>0</b>.
  <b>&lt;44</b> — Apple/Google tövsiyəsi. Kontrast sütununda yalnız <b>həqiqi</b> (hem ağ, həm qara fon
  ekstremalında uğursuz) sayğac göstərilir, xam say deyil.
</p>

<h2>7 · Rədd edilmiş tapıntılar — dürüstlük qeydi</h2>
<p>
  İlk ölçmə keçidində bir neçə «qüsur» çıxdı ki, yoxlayanda <b>sınağın özünün səhvi</b> idi.
  Onları hesabatda saxlamaq vacibdir: əks halda düzgün işləyən hissələr səhvən yenidən yazılardı.
</p>
<div class="tscroll">
<table>
<thead><tr><th>Səhv</th><th>İlk iddia</th><th>Həqiqət</th></tr></thead>
<tbody>
{{FALSEPOS}}
</tbody>
</table>
</div>

<h2>8 · Nəyi dəyişmək — prioritet sırası</h2>
<ol class="rec">
  <li><b>Ürək düyməsini böyüt və kartın klikindən ayır</b>
    Menyuda 130 kartın hər birində 28×32 px ürək var və kartın özü səbətə əlavə edir. Hədəfi 44×44-ə
    çıxarmaq və <code>stopPropagation</code> tətbiq etmək lazımdır — yoxsa hər səhv toxunuş
    istənməyən səbət sətri yaradır.</li>
  <li><b>Boz mətn şkalasını <code>α ≥ .58</code>-ə çıxar</b>
    Bir neçə CSS sətri 20 kontrast pozuntusunun əksəriyyətini bağlayır. Ən çox qazanan:
    Təkliflər boş vəziyyəti, Menyu alt başlığı, Profil bölmə başlıqları.</li>
  <li><b>«NEW» məntiqini düzəlt</b>
    <code>OrderTab.tsx:957</code>-də üçüncü hal fallback-dır. Ya real yenilik bayrağı tələb et
    (məhsul yaradılma tarixi / <code>is_new</code> sahəsi), ya da nişanı heç göstərmə. İndiki hal
    «yeni» sözünü mənasız edir.</li>
  <li><b>Sahə şriftlərini 16 px et</b>
    Axtarış və rəy sahələri 13 px-dir; iOS fokus zamanı səhifəni böyüdüb geri qaytarmır.</li>
  <li><b><code>loading=\"lazy\"</code> əlavə et</b>
    130 məhsul şəkli açılışda yüklənir. Bir atribut mobil açılışı yüngülləşdirir.</li>
  <li><b>Başlıq strukturu və etiketlər</b>
    Boş ekranlara bir <code>H1</code>, ikon düymələrə <code>aria-label</code>, naviqasiyaya
    <code>role=tablist</code>. Ekran oxuyucusu üçün tətbiq açılır.</li>
  <li><b>Naviqasiyaya qalan 4 ekranı əlavə et</b>
    Təkliflər, AI, Rəy və Profil yalnız səhifə daxilindən tapılır.</li>
  <li><b><code>/vite.svg</code>-i <code>/logo.jpg</code> ilə əvəz et</b>
    <code>index.html:5</code> Vite şablonundan qalıb; <code>customer.html</code> artıq düzgündür.</li>
</ol>

<div class="callout">
  <b>Tətbiqin güclü tərəfi qorunmalıdır</b>
  Üfüqi daşmanın dörd ölçüdə sıfır olması və heç bir məcburi toxunma pozuntusunun olmaması
  yaxşı nəticədir. Yuxarıdaki düzəlişlər bu iki nəticəni poza bilər — hər dəyişiklikdən sonra
  <code>scripts/customer_app_ux_audit.py</code> yenidən işlədilməli və hər iki göstərici
  <b>0</b> qalmalıdır.
</div>

<footer>
  Ölçmə alətləri: <code>scripts/customer_app_ux_audit.py</code> (DOM ölçmələri) ·
  <code>scripts/pixel_contrast.py</code> (piksel kontrastı) ·
  <code>outputs/customer-app-ux-audit/audit.json</code> (xam verilənlər).
  Canlı hədəf: <code>https://super.ironwaves.store/?join=1</code> · tarix: 2026-10-12.
</footer>

</div>
</body>
</html>
"""

html = HTML
for token, value in (
    ("{{CSS}}", CSS),
    ("{{FINDINGS}}", findings_html()),
    ("{{CONTRAST}}", contrast_html()),
    ("{{TOUCH}}", touch_html()),
    ("{{PERF}}", perf_rows()),
    ("{{SHOTS}}", shots_html()),
    ("{{STRENGTHS}}", strengthen()),
    ("{{FALSEPOS}}", false_positives()),
    ("{{MANDATORY}}", str(N_MANDATORY)),
    ("{{MENU44}}", str(N_MENU_44)),
    ("{{NCONF}}", str(N_CONF)),
    ("{{NCOLLECTED}}", str(N_COLLECTED)),
    ("{{NUNC}}", str(N_COLLECTED - N_CONF)),
    ("{{MENUIMG}}", str(N_MENU_IMGS)),
    ("{{NSCREENS}}", str(len(ALL_TABS))),
):
    html = html.replace(token, value)

leftover = re.findall(r"\{\{[A-Z]+\}\}", html)
if leftover:
    raise SystemExit("doldurulmamış yer tutucu: %s" % ", ".join(sorted(set(leftover))))

# Guard the headline claims: if a number contradicts the report's own narrative the report is
# wrong, not the app. These two assertions are the ones the summary sentence depends on.
if N_MANDATORY != 0:
    raise SystemExit(f"hesabat '0 məcburi pozuntu' deyir, lakin {N_MANDATORY} tapıldı")
if N_OVERFLOW != 0:
    raise SystemExit(f"hesabat 'üfüqi daşma yoxdur' deyir, lakin {N_OVERFLOW} ekranda var")

# Every table must scroll horizontally on a phone — a mobile audit whose report overflows
# horizontally is not credible. The tables are wrapped in the template already, so this only
# ASSERTS that none was left bare: a missed wrapper is silent otherwise.
tables = html.count("<table>")
wrapped = html.count('<div class="tscroll">')
if tables != wrapped:
    raise SystemExit("cədvəl sayı uyğun deyil: %d cədvəl, %d sarma" % (tables, wrapped))

HTML_OUT.parent.mkdir(parents=True, exist_ok=True)
HTML_OUT.write_text(html, encoding="utf-8")
print(f"yazıldı: {HTML_OUT}  ({len(html.encode()) / 1024:.0f} KB, {tables} cədvəl, "
      f"{html.count('<img')} şəkil)")
