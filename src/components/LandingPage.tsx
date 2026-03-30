import React from 'react';

const demoUrl = 'https://demo.ironwaves.store';
const appUrl = 'https://super.ironwaves.store';

const highlights = [
  { value: '1 Core', label: 'all operations in one controlled platform' },
  { value: 'Live Demo', label: 'safe tenant for investor and client walkthroughs' },
  { value: 'Subdomain SaaS', label: 'each brand launches on its own workspace' },
];

const modules = [
  { title: 'POS and Checkout', text: 'Fast cashier flow, split payments, staff limits, QR rewards, and direct receipt handling.' },
  { title: 'Kitchen and Tables', text: 'Table service, kitchen status flow, dine-in orchestration, and service-ready visibility.' },
  { title: 'Finance and Reports', text: 'Cash, card, investor debt, Z-report, analytics, and daily operational visibility in one place.' },
  { title: 'Inventory and Recipes', text: 'Stock, costing, loss tracking, recipe-based consumption, and audit-friendly movement history.' },
  { title: 'CRM and Loyalty', text: 'QR loyalty cards, campaigns, rewards, cashback models, customer app, and tenant branding.' },
  { title: 'Multi-tenant Rollout', text: 'One codebase, isolated client workspaces, custom domains, demo routing, and brand-level settings.' },
];

const rollout = [
  { host: 'www.ironwaves.store', type: 'Landing', note: 'Your public product site, screenshots, story, and sales CTA.' },
  { host: 'demo.ironwaves.store', type: 'Demo', note: 'A resettable sandbox tenant with safe sample accounts and fresh demo data.' },
  { host: 'super.ironwaves.store', type: 'Platform', note: 'Your core control layer for management, rollout, and platform ownership.' },
  { host: 'client-name.ironwaves.store', type: 'Tenant', note: 'Dedicated branded production workspace for each customer.' },
];

const sellingPoints = [
  'Designed for coffee shops, restaurants, dessert brands, and hybrid concepts',
  'Supports branded tenant rollout without maintaining separate codebases',
  'Works with Railway deployment and Neon Postgres architecture',
  'Built to combine operations, finance, CRM, and loyalty in one interface',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-auto bg-[#0d1218] text-slate-100">
      <section className="relative isolate overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(248,199,0,0.18),transparent_22%),radial-gradient(circle_at_78%_10%,rgba(34,211,238,0.18),transparent_18%),radial-gradient(circle_at_70%_85%,rgba(59,130,246,0.12),transparent_16%),linear-gradient(140deg,#202836_0%,#131922_52%,#0b1016_100%)]" />
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)', backgroundSize: '36px 36px' }} />

        <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-8 md:px-10 lg:px-14 lg:pb-24">
          <div className="flex flex-col gap-16 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="inline-flex rounded-full border border-yellow-200/20 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.28em] text-yellow-200/85">
                iRonWaves POS RC
              </div>
              <h1 className="mt-6 max-w-5xl font-[Georgia] text-5xl font-bold leading-[0.92] text-white md:text-7xl">
                One premium POS core for operations, finance, CRM, loyalty, and brand rollout.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                Present the platform on `www`, onboard prospects into a live resettable demo, and launch each customer on its own branded subdomain with isolated users, finance, inventory, kitchen, loyalty, and reporting.
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

              <div className="mt-10 grid gap-3 md:grid-cols-2">
                {sellingPoints.map((item) => (
                  <div key={item} className="rounded-[22px] border border-white/10 bg-slate-950/30 px-4 py-3 text-sm leading-6 text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="w-full max-w-xl rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Go-to-market Flow</div>
                  <div className="mt-2 text-2xl font-bold text-white">Demo-first sales model</div>
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

              <div className="mt-5 rounded-[24px] border border-yellow-300/15 bg-yellow-400/8 p-4">
                <div className="text-sm font-semibold text-yellow-100">Demo tenant policy</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  Demo users can test sales, finance, tables, kitchen, QR loyalty, and customer app flows. When a demo user logs out, demo operational data is reset so the next client sees a clean environment.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14 md:px-10 lg:px-14">
        <div className="grid gap-6 lg:grid-cols-3">
          {modules.map((item) => (
            <div key={item.title} className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6">
              <div className="text-sm uppercase tracking-[0.22em] text-slate-400">Module</div>
              <h2 className="mt-3 text-2xl font-bold text-white">{item.title}</h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 md:px-10 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6">
            <div className="text-sm uppercase tracking-[0.22em] text-slate-400">Suggested sales journey</div>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-sm font-semibold text-white">1. Prospect lands on `www`</div>
                <div className="mt-1 text-sm text-slate-300">Reads the product story, sees modules, brand rollout logic, and product positioning.</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-sm font-semibold text-white">2. Clicks “Try Live Demo”</div>
                <div className="mt-1 text-sm text-slate-300">Enters `demo.ironwaves.store` with safe sample users and fresh resettable data.</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-sm font-semibold text-white">3. Becomes a tenant</div>
                <div className="mt-1 text-sm text-slate-300">Gets a dedicated branded subdomain with isolated settings, CRM, inventory, finance, and users.</div>
              </div>
            </div>
          </div>

          <div className="rounded-[30px] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(34,211,238,0.02))] p-6">
            <div className="text-sm uppercase tracking-[0.22em] text-cyan-200/80">Call to action</div>
            <h3 className="mt-3 text-3xl font-bold text-white">Show the full system before the sale</h3>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Give clients one place to understand the product, one place to test it live, and one dedicated branded workspace once they become a customer.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <a href={demoUrl} className="glossy-gold inline-flex min-h-13 items-center justify-center rounded-2xl px-6 py-3 text-base font-bold">
                Open Demo Tenant
              </a>
              <a href={appUrl} className="neon-btn inline-flex min-h-13 items-center justify-center rounded-2xl px-6 py-3 text-base font-semibold">
                Open Platform
              </a>
            </div>
            <div className="mt-6 rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm leading-7 text-slate-300">
              Best practice:
              keep `www` as the product site, `demo` as the resettable sandbox, and every customer on its own branded subdomain.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
