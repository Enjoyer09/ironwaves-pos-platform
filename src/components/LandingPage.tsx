import React from 'react';

const demoUrl = 'https://demo.ironwaves.store';
const appUrl = 'https://super.ironwaves.store';

const featureCards = [
  {
    title: 'Multi-tenant setup',
    body: 'Each brand can run on its own subdomain with separate users, settings, and data flow.',
  },
  {
    title: 'Fast POS flow',
    body: 'Touch-first checkout, kitchen routing, tables, CRM, finance, and reporting in one system.',
  },
  {
    title: 'Demo-ready rollout',
    body: 'Marketing site on www, demo tenant on demo, and production tenants on their own branded subdomains.',
  },
];

const tenants = ['demo.ironwaves.store', 'gyropos.ironwaves.store', 'socialbee.ironwaves.store', 'emalatkhanaart.ironwaves.store'];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-auto bg-[radial-gradient(circle_at_top,#304055_0%,#18202b_48%,#0e131a_100%)] text-slate-100">
      <section className="relative isolate overflow-hidden px-6 pb-14 pt-8 md:px-10 lg:px-14">
        <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(248,199,0,0.10),transparent_28%,rgba(45,212,191,0.10)_62%,transparent_100%)]" />
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-yellow-300/10 blur-3xl" />
        <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-cyan-300/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full border border-yellow-200/20 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.22em] text-yellow-200/80">
                iRonWaves POS RC
              </div>
              <h1 className="mt-6 max-w-4xl font-[Georgia] text-5xl font-bold leading-[0.96] text-white md:text-7xl">
                POS, kitchen, CRM, finance, and branded tenant rollout from one core platform.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                `www` becomes your product landing page, `demo` becomes your safe public demo, and each customer can run on its own branded subdomain with isolated operations.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={demoUrl}
                  className="glossy-gold inline-flex min-h-13 items-center justify-center rounded-2xl px-6 py-3 text-base font-bold"
                >
                  Open Demo
                </a>
                <a
                  href={appUrl}
                  className="neon-btn inline-flex min-h-13 items-center justify-center rounded-2xl px-6 py-3 text-base font-semibold"
                >
                  Go To Live App
                </a>
              </div>
            </div>

            <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="text-sm uppercase tracking-[0.18em] text-slate-400">Launch model</div>
                  <div className="mt-1 text-2xl font-bold text-white">Subdomain-first SaaS</div>
                </div>
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200">
                  Ready for Railway
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {tenants.map((tenant) => (
                  <div key={tenant} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-3">
                    <div className="text-sm text-slate-300">{tenant}</div>
                    <div className="rounded-full bg-white/8 px-3 py-1 text-xs font-semibold text-slate-200">
                      tenant
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {featureCards.map((card) => (
              <div key={card.title} className="rounded-[24px] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                <div className="text-lg font-semibold text-white">{card.title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
