import React from 'react';

const demoUrl = 'https://demo.ironwaves.store';
const appUrl = 'https://super.ironwaves.store';

const highlights = [
  { value: '1 Core', label: 'platform for all your brands' },
  { value: '1 Demo', label: 'safe public environment' },
  { value: '∞ Tenants', label: 'subdomain-based rollout' },
];

const modules = [
  'POS checkout',
  'Kitchen display',
  'Tables and dine-in',
  'Finance and investor flow',
  'CRM and QR loyalty',
  'Inventory and recipe costing',
];

const rollout = [
  { host: 'www.ironwaves.store', type: 'Landing', note: 'Marketing site and product presentation' },
  { host: 'demo.ironwaves.store', type: 'Demo', note: 'Safe sandbox with sample accounts and resettable data' },
  { host: 'gyropos.ironwaves.store', type: 'Tenant', note: 'Brand-specific production workspace' },
  { host: 'socialbee.ironwaves.store', type: 'Tenant', note: 'Dedicated tenant with own users and settings' },
  { host: 'emalatkhanaart.ironwaves.store', type: 'Tenant', note: 'Independent branded rollout' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-auto bg-[#0e141c] text-slate-100">
      <section className="relative isolate overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(248,199,0,0.18),transparent_22%),radial-gradient(circle_at_80%_15%,rgba(56,189,248,0.16),transparent_20%),linear-gradient(140deg,#202836_0%,#131922_52%,#0b1016_100%)]" />
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)', backgroundSize: '36px 36px' }} />

        <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-8 md:px-10 lg:px-14 lg:pb-24">
          <div className="flex flex-col gap-16 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="inline-flex rounded-full border border-yellow-200/20 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.28em] text-yellow-200/85">
                iRonWaves POS RC
              </div>
              <h1 className="mt-6 max-w-5xl font-[Georgia] text-5xl font-bold leading-[0.92] text-white md:text-7xl">
                Branded POS rollout for every tenant, from one product core.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                Launch your public website on `www`, route prospects into `demo`, and operate each client on its own subdomain with isolated finance, users, kitchen, CRM, and inventory.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={demoUrl}
                  className="glossy-gold inline-flex min-h-13 items-center justify-center rounded-2xl px-7 py-3 text-base font-bold"
                >
                  Try Live Demo
                </a>
                <a
                  href={appUrl}
                  className="neon-btn inline-flex min-h-13 items-center justify-center rounded-2xl px-7 py-3 text-base font-semibold"
                >
                  Open Production App
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {highlights.map((item) => (
                  <div key={item.label} className="rounded-[24px] border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                    <div className="text-2xl font-black text-white">{item.value}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-300">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Launch Architecture</div>
                  <div className="mt-2 text-2xl font-bold text-white">Subdomain-first SaaS model</div>
                </div>
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200">
                  Railway ready
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {rollout.map((item) => (
                  <div key={item.host} className="rounded-[24px] border border-white/10 bg-slate-950/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-white">{item.host}</div>
                      <div className="rounded-full bg-white/8 px-3 py-1 text-xs font-semibold text-slate-200">{item.type}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-400">{item.note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14 md:px-10 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6">
            <div className="text-sm uppercase tracking-[0.22em] text-slate-400">Why this setup works</div>
            <h2 className="mt-3 text-3xl font-bold text-white">One codebase, many branded deployments</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Instead of managing separate products, you keep one controlled platform and route each customer by host. That means faster onboarding, cleaner updates, isolated operations, and a much more professional sales flow.
            </p>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {modules.map((item) => (
                <div key={item} className="rounded-2xl border border-white/8 bg-slate-950/25 px-4 py-3 text-sm text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-yellow-300/10 bg-[linear-gradient(180deg,rgba(248,199,0,0.08),rgba(248,199,0,0.02))] p-6">
            <div className="text-sm uppercase tracking-[0.22em] text-yellow-200/80">Suggested funnel</div>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-sm font-semibold text-white">1. Prospect lands on `www`</div>
                <div className="mt-1 text-sm text-slate-300">Reads the product story, sees modules, screenshots, and clear CTA buttons.</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-sm font-semibold text-white">2. Clicks “Try Live Demo”</div>
                <div className="mt-1 text-sm text-slate-300">Gets redirected to `demo.ironwaves.store` with ready-made accounts.</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-sm font-semibold text-white">3. Becomes a tenant</div>
                <div className="mt-1 text-sm text-slate-300">Receives a dedicated branded subdomain like `gyropos` or `socialbee`.</div>
              </div>
            </div>
            <a href={demoUrl} className="glossy-gold mt-6 inline-flex min-h-13 w-full items-center justify-center rounded-2xl px-6 py-3 text-base font-bold">
              Launch Demo Tenant
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
