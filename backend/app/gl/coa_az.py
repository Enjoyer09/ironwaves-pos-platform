"""Azərbaycan Milli Hesablar Planı (AMHP) — restoran/POS üçün seed.

Kommersiya təşkilatları üçün Milli Hesablar Planının əsas hesabları və
POS əməliyyatları üçün lazım olan subhesablar. Kod strukturu:
    3 rəqəm  = AMHP sintetik hesab   (məs. 221 Kassa)
    xxx.n    = tenant subhesabı       (məs. 221.1 POS kassası)

VACİB: Hesab nömrələri/adları mühasib tərəfindən yoxlanmalıdır. Posting
qaydaları nömrəyə yox ``system_role``-a bağlıdır, ona görə tenant hesabın
kodunu/adını dəyişə bilər, qaydalar pozulmur.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AccountDef:
    code: str
    name: str
    account_type: str  # asset | liability | equity | revenue | expense
    parent: str | None = None
    system_role: str | None = None
    normal_side: str | None = None  # override for contra accounts
    allow_negative: bool = True
    requires_partner: bool = False


def _default_side(account_type: str) -> str:
    return "debit" if account_type in {"asset", "expense"} else "credit"


# fmt: off
AMHP_ACCOUNTS: tuple[AccountDef, ...] = (
    # ── Bölmə 1: Uzunmüddətli aktivlər ─────────────────────────────────────
    AccountDef("101", "Qeyri-maddi aktivlər — dəyəri", "asset"),
    AccountDef("102", "Qeyri-maddi aktivlər — amortizasiya", "asset", normal_side="credit"),
    AccountDef("111", "Torpaq, tikili və avadanlıqlar — dəyəri", "asset", system_role="fixed_assets"),
    AccountDef("112", "Torpaq, tikili və avadanlıqlar — amortizasiya", "asset", normal_side="credit", system_role="accumulated_depreciation"),

    # ── Bölmə 2: Qısamüddətli aktivlər ─────────────────────────────────────
    AccountDef("201", "Material ehtiyatları", "asset", system_role="inventory"),
    AccountDef("205", "Mallar", "asset", system_role="merchandise"),
    AccountDef("211", "Alıcılar və sifarişçilərin qısamüddətli debitor borcları", "asset", system_role="accounts_receivable", requires_partner=False),
    AccountDef("218", "Digər qısamüddətli debitor borcları", "asset"),
    AccountDef("218.1", "Verilmiş borclar (nisyə/borc)", "asset", parent="218", system_role="other_receivable"),
    AccountDef("221", "Kassa", "asset"),
    AccountDef("221.1", "POS kassası (nağd)", "asset", parent="221", system_role="cash_drawer", allow_negative=False),
    AccountDef("221.2", "Seyf", "asset", parent="221", system_role="safe", allow_negative=False),
    AccountDef("222", "Yolda olan pul köçürmələri", "asset", system_role="cash_in_transit"),
    AccountDef("223", "Bank hesablaşma hesabları", "asset"),
    AccountDef("223.1", "Əsas bank hesabı (kart ödənişləri)", "asset", parent="223", system_role="bank_main"),
    AccountDef("241", "Əvəzləşdirilən ƏDV", "asset", system_role="vat_input"),
    AccountDef("244", "Verilmiş qısamüddətli avanslar", "asset", system_role="advances_paid"),
    AccountDef("245", "Təhtəlhesab məbləğlər", "asset", system_role="accountable_persons"),

    # ── Bölmə 3: Kapital ───────────────────────────────────────────────────
    AccountDef("301", "Nizamnamə (nominal) kapitalı", "equity", system_role="share_capital"),
    AccountDef("341", "Hesabat dövründə xalis mənfəət (zərər)", "equity", system_role="current_year_earnings"),
    AccountDef("343", "Keçmiş illər üzrə bölüşdürülməmiş mənfəət (ödənilməmiş zərər)", "equity", system_role="retained_earnings"),
    AccountDef("344", "Elan edilmiş dividendlər", "equity", normal_side="debit", system_role="dividends"),

    # ── Bölmə 4: Uzunmüddətli öhdəliklər ───────────────────────────────────
    AccountDef("401", "Uzunmüddətli bank kreditləri", "liability", system_role="long_term_loans"),

    # ── Bölmə 5: Qısamüddətli öhdəliklər ───────────────────────────────────
    AccountDef("511", "Qısamüddətli bank kreditləri", "liability", system_role="short_term_loans"),
    AccountDef("521", "Vergi öhdəlikləri", "liability"),
    AccountDef("521.1", "ƏDV öhdəliyi", "liability", parent="521", system_role="vat_output"),
    AccountDef("521.2", "Sadələşdirilmiş vergi öhdəliyi", "liability", parent="521", system_role="simplified_tax_payable"),
    AccountDef("521.3", "Gəlir vergisi (əmək haqqından)", "liability", parent="521", system_role="income_tax_withheld"),
    AccountDef("522", "Sosial sığorta və təminat üzrə öhdəliklər", "liability", system_role="social_insurance_payable"),
    AccountDef("531", "Malsatan və podratçılara qısamüddətli kreditor borcları", "liability", system_role="accounts_payable", requires_partner=False),
    AccountDef("533", "Əməyin ödənişi üzrə işçi heyətinə olan borclar", "liability", system_role="payroll_payable"),
    AccountDef("538", "Digər qısamüddətli kreditor borcları", "liability"),
    AccountDef("538.1", "Təsisçi / investor borcu", "liability", parent="538", system_role="investor_loan"),
    AccountDef("538.2", "Digər borc alınmış vəsaitlər", "liability", parent="538", system_role="other_borrowings"),
    AccountDef("538.9", "Aydınlaşdırılmamış məbləğlər (suspense)", "liability", parent="538", system_role="suspense"),
    AccountDef("543", "Alınmış qısamüddətli avanslar", "liability"),
    AccountDef("543.1", "Müştəri depozitləri (masa/rezerv)", "liability", parent="543", system_role="customer_deposits"),

    # ── Bölmə 6: Gəlirlər ──────────────────────────────────────────────────
    AccountDef("601", "Satış", "revenue"),
    AccountDef("601.1", "Məhsul satışı (POS)", "revenue", parent="601", system_role="sales_revenue"),
    AccountDef("602", "Satılmış malların qaytarılması və endirimlər", "revenue", normal_side="debit", system_role="sales_discounts"),
    AccountDef("611", "Sair əməliyyat gəlirləri", "revenue"),
    AccountDef("611.1", "Kassa artığı", "revenue", parent="611", system_role="cash_overage"),
    AccountDef("611.9", "Digər əməliyyat gəlirləri", "revenue", parent="611", system_role="other_income"),

    # ── Bölmə 7: Xərclər ───────────────────────────────────────────────────
    AccountDef("701", "Satışın maya dəyəri", "expense", system_role="cogs"),
    AccountDef("711", "Kommersiya xərcləri", "expense"),
    AccountDef("711.1", "Bank / ekvayrinq komissiyası", "expense", parent="711", system_role="bank_fees"),
    AccountDef("711.9", "Digər kommersiya xərcləri", "expense", parent="711", system_role="selling_expense"),
    AccountDef("721", "İnzibati xərclər", "expense"),
    AccountDef("721.1", "Əmək haqqı", "expense", parent="721", system_role="payroll_expense"),
    AccountDef("721.2", "İcarə", "expense", parent="721", system_role="rent_expense"),
    AccountDef("721.3", "Kommunal xərclər", "expense", parent="721", system_role="utilities_expense"),
    AccountDef("721.4", "İşçi yeməyi (staff benefit)", "expense", parent="721", system_role="staff_meals"),
    AccountDef("721.9", "Digər inzibati xərclər", "expense", parent="721", system_role="general_expense"),
    AccountDef("731", "Sair əməliyyat xərcləri", "expense"),
    AccountDef("731.1", "Ehtiyat itkisi / silinmə", "expense", parent="731", system_role="inventory_writeoff"),
    AccountDef("731.2", "Kassa kəsiri", "expense", parent="731", system_role="cash_shortage"),
    AccountDef("731.3", "Sadələşdirilmiş vergi xərci", "expense", parent="731", system_role="simplified_tax_expense"),
    AccountDef("731.4", "Cərimə və sanksiyalar", "expense", parent="731", system_role="penalties"),
    AccountDef("751", "Maliyyə xərcləri", "expense", system_role="finance_costs"),

    # ── Bölmə 9: Mənfəət vergisi ───────────────────────────────────────────
    AccountDef("901", "Cari mənfəət vergisi üzrə xərclər", "expense", system_role="income_tax_expense"),
)
# fmt: on

# System roles that posting rules rely on. Seeding must provide every one.
REQUIRED_ROLES = frozenset(a.system_role for a in AMHP_ACCOUNTS if a.system_role)

# Legacy v1 wallet codes -> v2 system roles (used by the P1 migration).
LEGACY_CODE_TO_ROLE = {
    "cash": "cash_drawer",
    "card": "bank_main",
    "safe": "safe",
    "payable": "accounts_payable",
    "deposit": "customer_deposits",
    "investor": "investor_loan",
    "debt": "other_receivable",
    "inventory_asset": "inventory",
    "revenue": "sales_revenue",
    "cogs": "cogs",
    "expense": "general_expense",
    "adjustment": "suspense",
}


def account_class(code: str) -> int:
    return int(code[0])


def normal_side(defn: AccountDef) -> str:
    return defn.normal_side or _default_side(defn.account_type)
