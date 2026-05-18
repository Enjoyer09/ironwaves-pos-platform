import{Y as ke,g as je,b as Se,w as J,j as e}from"./index-xRtfLaNx.js";import{R as r,Y as Ne,Z as ee,_ as _e,$ as Re,a0 as Ce,a1 as ze,a2 as Pe,a3 as Fe}from"./icons-DTCrD5ob.js";import{g as qe,s as Ue}from"./feedback-DPWNXehN.js";import{Q as Ae}from"./browser-BcO_zNZy.js";import"./react-CWlDXkhO.js";import"./decimal-CNo3oIkL.js";import"./qr-Dyuq_T0S.js";function Xe({tenantId:b="",saleId:te="",receiptId:p="",receiptToken:g="",source:ae="receipt"}){const[f,z]=r.useState(null),[u,P]=r.useState(null),[c,se]=r.useState(0),[w,re]=r.useState(""),[y,ne]=r.useState([]),[F,ie]=r.useState(""),[q,U]=r.useState(!1),[le,A]=r.useState(!1),[E,T]=r.useState(!1),[$,k]=r.useState(""),[i,B]=r.useState(null),[h,j]=r.useState(""),[G,Q]=r.useState(!1),[oe,L]=r.useState(!1),[de,D]=r.useState(!1);r.useEffect(()=>{let t=!0;return(async()=>{try{const s=String(b||"").trim();if(!s)return;const[n]=await Promise.all([ke(s).catch(()=>je(s))]);if(!t)return;z(n||null);const a=await Se(s).catch(()=>J(s));if(!t)return;P(a||J(s))}catch{if(!t)return;z(null),P(null)}})(),()=>{t=!1}},[b]),r.useEffect(()=>{let t=!1;const s=String(b||"").trim(),n=String(p||"").trim(),a=String(g||"").trim();return!s||!n||!a?()=>{t=!0}:((async()=>{const x=await qe(s,n,a);t||!x||(B({code:x.code,percent:x.percent}),T(!0),A(!0))})(),()=>{t=!0})},[b,p,g]),r.useEffect(()=>{let t=!1;return(async()=>{if(!i?.code){t||j("");return}try{const s=`IWPOS:FB:${String(i.code).trim().toUpperCase()}`,n=await Ae.toDataURL(s,{width:220,margin:1});t||j(n)}catch{t||j("")}})(),()=>{t=!0}},[i?.code]);const W=u?.feedback_settings||{},X=String(W?.google_review_url||f?.google_review_url||f?.feedback_settings?.google_review_url||"").trim();String(u?.customer_app_settings?.primary_color||"#facc15"),String(u?.customer_app_settings?.accent_color||"#22d3ee"),String(u?.customer_app_settings?.background_color||"#0b1220");const ce="#0F172A",S=String(f?.company_name||f?.name||"iRonWaves").trim(),O=String(f?.logo_url||"").trim(),xe=(S.match(/\p{L}|\p{N}/u)?.[0]||"I").toUpperCase(),me="Rəy və məmnuniyyət sorğusu",be="Xidmət keyfiyyətini yaxşılaşdırmaq üçün 30 saniyə ayırın.",Y=c>0&&c<=3,I=!!(String(p||"").trim()&&String(g||"").trim()),N=I&&c>=1&&(!Y||w.trim().length>=3)&&!q,v=String(p||"").trim()&&String(g||"").trim()?`/?r=${encodeURIComponent(String(p||"").trim())}&t=${encodeURIComponent(String(g||"").trim())}`:"",pe=["❤️ Xidmət əla idi","☕ Dad mükəmməl idi","✨ Məkan çox təmiz idi","👤 Personal peşəkar idi","🏷️ Qiymət/dəyər çox yaxşı idi","👍 Mütləq tövsiyə edərəm"],ge=t=>{ne(s=>s.includes(t)?s.filter(n=>n!==t):[...s,t])},fe=async()=>{if(k(""),!!N)try{L(!0),D(!0),window.setTimeout(()=>L(!1),160),window.setTimeout(()=>D(!1),520),U(!0);const t=[y.length?`[Preset səbəblər] ${y.join(", ")}`:"",w.trim()].filter(Boolean).join(`
`),s=await Ue({tenant_id:String(b||"tenant_default"),sale_id:String(te||"").trim()||void 0,receipt_id:String(p||"").trim()||void 0,receipt_token:String(g||"").trim()||void 0,source:ae,score:c,comment:t||void 0,contact:F.trim()||void 0});s?.coupon_code&&B({code:String(s.coupon_code),percent:Number(s.coupon_percent||5)}),T(!!s?.already_submitted),A(!0)}catch(t){k(String(t?.message||"Feedback göndərmək alınmadı"))}finally{U(!1)}},ue=async()=>{if(i?.code)try{Q(!0);const t=1080,s=1700,n=document.createElement("canvas");n.width=t,n.height=s;const a=n.getContext("2d");if(!a)throw new Error("Canvas unavailable");const x=a.createLinearGradient(0,0,t,s);x.addColorStop(0,"#0b1220"),x.addColorStop(1,"#111827"),a.fillStyle=x,a.fillRect(0,0,t,s);const l=80,d=120,K=t-160,M=s-240;a.fillStyle="#0f172a",a.strokeStyle="#334155",a.lineWidth=3,a.beginPath(),a.roundRect(l,d,K,M,28),a.fill(),a.stroke();const he=String(f?.company_name||"ironWaves");if(a.fillStyle="#e2e8f0",a.font="700 52px Arial",a.fillText(he,l+50,d+90),a.fillStyle="#94a3b8",a.font="500 34px Arial",a.fillText("Feedback kuponu",l+50,d+150),a.fillStyle="#22c55e",a.font="700 72px Arial",a.fillText(`-${i.percent}% ENDIRIM`,l+50,d+265),a.fillStyle="#f8fafc",a.font="700 64px Arial",a.fillText(i.code,l+50,d+360),a.fillStyle="#cbd5e1",a.font="500 30px Arial",a.fillText("Növbəti alışda bu kodu kassada göstərin.",l+50,d+420),h){const o=new Image;await new Promise((we,ye)=>{o.onload=()=>we(),o.onerror=()=>ye(new Error("QR load failed")),o.src=h});const m=360,Z=l+(K-m)/2,C=d+500;a.fillStyle="#ffffff",a.fillRect(Z-14,C-14,m+28,m+28),a.drawImage(o,Z,C,m,m),a.fillStyle="#94a3b8",a.font="500 28px Arial",a.fillText("Kassada QR-i skan edin (IWPOS:FB)",l+180,C+m+60)}const ve=new Date().toLocaleString("az-AZ");a.fillStyle="#64748b",a.font="500 24px Arial",a.fillText(`Verilmə tarixi: ${ve}`,l+50,d+M-70);const _=await new Promise(o=>n.toBlob(o,"image/png"));if(!_)throw new Error("PNG export failed");const H=`feedback-coupon-${i.code}.png`;if(typeof navigator<"u"&&typeof navigator.share=="function"&&typeof navigator.canShare=="function"){const o=new File([_],H,{type:"image/png"});if(navigator.canShare({files:[o]})){await navigator.share({title:"Feedback Kuponu",text:"Kuponu Photos qalereyasına yadda saxlayın.",files:[o]});return}}const V=URL.createObjectURL(_),R=document.createElement("a");R.href=V,R.download=H,R.click(),URL.revokeObjectURL(V)}catch(t){k(String(t?.message||"PNG faylı saxlanmadı"))}finally{Q(!1)}};return b?I?e.jsxs("div",{className:"relative min-h-dvh overflow-x-hidden overflow-y-auto px-3 pb-24 pt-4 sm:px-4 sm:pb-28 sm:pt-5",style:{background:"linear-gradient(155deg, #8ec5ff 0%, #a48bff 28%, #ef8cf9 57%, #ffb58f 100%)"},children:[e.jsx("div",{className:"blob-wave blob-wave-a"}),e.jsx("div",{className:"blob-wave blob-wave-b"}),e.jsx("div",{className:"blob-wave blob-wave-c"}),e.jsxs("div",{className:"mx-auto w-full max-w-[430px]",children:[e.jsxs("div",{className:"glass-card relative overflow-hidden rounded-[26px] p-4 text-slate-900 sm:rounded-[30px] sm:p-5",children:[e.jsx("div",{className:"glass-inner-highlight"}),e.jsxs("div",{className:"mb-4 flex items-start justify-between gap-3",children:[e.jsxs("div",{className:"min-w-0 flex items-center gap-3",children:[O?e.jsx("img",{src:O,alt:S,className:"h-12 w-12 shrink-0 rounded-2xl object-cover shadow-[0_8px_24px_rgba(15,23,42,0.18)]",loading:"lazy"}):e.jsx("div",{className:"flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-yellow-400 font-black text-slate-900 shadow-[0_8px_24px_rgba(234,179,8,0.38)]",children:xe}),e.jsxs("div",{children:[e.jsx("h1",{className:"line-clamp-2 text-[20px] font-extrabold leading-tight sm:text-[22px]",style:{color:ce},children:S}),e.jsx("p",{className:"text-[12px] font-medium text-slate-600",children:me})]})]}),e.jsx("div",{className:"glass-bubble flex h-14 w-14 items-center justify-center rounded-full text-2xl",children:"☕"})]}),e.jsxs("div",{className:"glass-pill mb-4 flex items-start gap-2 rounded-2xl px-3 py-2.5",children:[e.jsx(Ne,{size:15,className:"mt-0.5 shrink-0 text-slate-600"}),e.jsx("p",{className:"text-[12px] leading-relaxed text-slate-700",children:be})]}),le?e.jsxs("div",{className:"glass-success rounded-3xl p-4 text-center",children:[e.jsx("div",{className:"text-lg font-bold text-emerald-900",children:E?"Siz artıq rəy bildirmisiniz":"Təşəkkür edirik"}),e.jsx("p",{className:"mt-2 text-sm text-emerald-900/80",children:E?"Bu çek üçün endirim kuponunuz artıq yaradılıb və aşağıda göstərilir.":String(W?.thank_you_text_az||"Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.")}),i?.code?e.jsxs("div",{className:"mt-4 rounded-2xl border border-emerald-300/60 bg-white/55 p-3 text-left",children:[e.jsx("div",{className:"text-xs font-semibold text-emerald-800/80",children:"Növbəti vizit üçün kupon"}),e.jsx("div",{className:"mt-1 text-2xl font-black tracking-wider text-emerald-900",children:i.code}),e.jsxs("div",{className:"mt-1 text-xs text-emerald-900/80",children:["POS-da kodu göstər, avtomatik ",i.percent,"% endirim tətbiq olunacaq."]}),h?e.jsxs("div",{className:"mt-3 flex flex-col items-center rounded-xl border border-emerald-300/50 bg-white/80 p-2",children:[e.jsx("img",{src:h,alt:"Feedback coupon QR",className:"h-28 w-28 rounded bg-white p-1"}),e.jsx("div",{className:"mt-2 text-[11px] text-emerald-900/80",children:"Kassada QR-i skan edin (IWPOS:FB)"})]}):null,e.jsx("button",{type:"button",onClick:ue,disabled:G,className:"mt-3 w-full rounded-full border border-emerald-300/80 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-500/30 disabled:opacity-60",children:G?"Şəkil hazırlanır...":"Save to Photos"})]}):null,v?e.jsxs("a",{href:v,className:"mt-4 mr-2 inline-flex items-center gap-1 rounded-full border border-slate-300/70 bg-white/60 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-white/80",children:[e.jsx(ee,{size:15}),"Çeki gör"]}):null,X?e.jsx("a",{href:X,target:"_blank",rel:"noreferrer",className:"mt-4 inline-flex items-center rounded-full bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.32)]",children:"Google Maps-də rəy yaz"}):null]}):e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"mb-3",children:[e.jsx("h3",{className:"mb-2 text-sm font-semibold text-slate-800",children:"Qiymətləndirmə"}),e.jsxs("div",{className:"star-strip relative flex items-center gap-1 rounded-2xl bg-white/35 px-2 py-2",children:[e.jsx("div",{className:"star-shimmer"}),[1,2,3,4,5].map(t=>e.jsx("button",{type:"button",onClick:()=>se(t),className:`star-btn rounded-xl p-2 transition ${c>=t?"is-active":""}`,"aria-label":`rate-${t}`,children:e.jsx(_e,{size:28,fill:c>=t?"url(#feedbackStarGradient)":"transparent",color:c>=t?"#7C3AED":"#64748b",strokeWidth:2})},t)),e.jsx("svg",{width:"0",height:"0",children:e.jsx("defs",{children:e.jsxs("linearGradient",{id:"feedbackStarGradient",x1:"0%",y1:"0%",x2:"100%",y2:"100%",children:[e.jsx("stop",{offset:"0%",stopColor:"#F97316"}),e.jsx("stop",{offset:"45%",stopColor:"#EC4899"}),e.jsx("stop",{offset:"100%",stopColor:"#6366F1"})]})})})]})]}),e.jsxs("div",{className:"mb-3 rounded-2xl border border-white/40 bg-white/30 p-3 backdrop-blur-xl",children:[e.jsx("div",{className:"mb-2 text-sm font-semibold text-slate-800",children:"Tag seçimi"}),e.jsx("div",{className:"flex flex-wrap gap-2",children:pe.map(t=>{const s=y.includes(t);return e.jsx("button",{type:"button",onClick:()=>ge(t),className:`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${s?"border-white/70 bg-white/65 text-slate-900 shadow-[0_8px_20px_rgba(99,102,241,0.22)]":"border-white/45 bg-white/35 text-slate-700 hover:bg-white/50"}`,children:t},t)})})]}),e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{children:[e.jsxs("label",{className:"mb-1 block text-sm font-semibold text-slate-800",children:["Şərh ",Y?"(mütləqdir)":"(opsional)"]}),e.jsx("textarea",{className:"glass-input min-h-[120px] w-full",value:w,onChange:t=>re(t.target.value),placeholder:"Nəyi yaxşılaşdıraq?"})]}),e.jsxs("div",{children:[e.jsx("label",{className:"mb-1 block text-sm font-semibold text-slate-800",children:"Əlaqə (opsional)"}),e.jsx("input",{className:"glass-input w-full",value:F,onChange:t=>ie(t.target.value),placeholder:"Telefon və ya email"})]}),$?e.jsx("div",{className:"text-sm font-medium text-rose-700",children:$}):null]}),e.jsxs("button",{type:"button",onClick:fe,disabled:!N,className:`cta-button relative mt-5 flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-bold text-white transition ${oe?"scale-[0.97]":"scale-100"} ${N?"":"cursor-not-allowed opacity-55"}`,children:[de?e.jsx("span",{className:"cta-ripple"}):null,e.jsx(Re,{size:16}),q?"Göndərilir...":"Rəyi göndər"]}),v?e.jsxs("a",{href:v,className:"mt-3 flex items-center justify-center gap-1 text-sm font-medium text-slate-700 underline decoration-dotted underline-offset-4 hover:text-slate-900",children:[e.jsx(ee,{size:15}),"Çeki gör"]}):null]})]}),e.jsxs("div",{className:"glass-dock mt-4 flex items-center justify-around rounded-[22px] px-4 py-3",children:[e.jsx("button",{className:"dock-btn",children:e.jsx(Ce,{size:18})}),e.jsx("button",{className:"dock-btn",children:e.jsx(ze,{size:18})}),e.jsx("button",{className:"dock-btn",children:e.jsx(Pe,{size:18})}),e.jsx("button",{className:"dock-btn",children:e.jsx(Fe,{size:18})})]})]}),e.jsx("style",{children:`
        .glass-safari {
          backdrop-filter: blur(22px);
          background: linear-gradient(135deg, rgba(255,255,255,0.28), rgba(255,255,255,0.12));
          border: 1px solid rgba(255,255,255,0.35);
          box-shadow: 0 10px 32px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255,255,255,0.45);
        }
        .glass-card {
          backdrop-filter: blur(26px);
          background: linear-gradient(145deg, rgba(255,255,255,0.32), rgba(255,255,255,0.18));
          border: 1px solid rgba(255,255,255,0.45);
          box-shadow: 0 22px 45px rgba(15, 23, 42, 0.2), inset 0 1px 0 rgba(255,255,255,0.55);
          animation: cardIn 520ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .glass-inner-highlight {
          pointer-events: none;
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 35%);
          opacity: 0.45;
        }
        .glass-bubble {
          backdrop-filter: blur(18px);
          background: rgba(255,255,255,0.35);
          border: 1px solid rgba(255,255,255,0.5);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.65), 0 10px 25px rgba(15,23,42,0.14);
        }
        .glass-pill {
          backdrop-filter: blur(16px);
          background: rgba(255,255,255,0.36);
          border: 1px solid rgba(255,255,255,0.4);
        }
        .glass-input {
          border-radius: 22px;
          border: 1px solid rgba(255,255,255,0.55);
          background: rgba(255,255,255,0.45);
          color: #0f172a;
          padding: 12px 14px;
          backdrop-filter: blur(14px);
          outline: none;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.75);
        }
        .glass-input::placeholder {
          color: #64748b;
        }
        .glass-input:focus {
          border-color: rgba(129,140,248,0.8);
          box-shadow: 0 0 0 3px rgba(129,140,248,0.2), inset 0 1px 0 rgba(255,255,255,0.85);
        }
        .star-strip {
          overflow: hidden;
        }
        .star-shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(115deg, rgba(255,255,255,0) 10%, rgba(255,255,255,0.45) 32%, rgba(255,255,255,0) 52%);
          transform: translateX(-120%);
          animation: starSweep 3s ease-in-out infinite;
          pointer-events: none;
        }
        .star-btn {
          position: relative;
          z-index: 2;
        }
        .star-btn.is-active {
          filter: brightness(1.06);
          transform: scale(1.05);
          animation: starPulse 460ms ease;
        }
        .cta-button {
          background: linear-gradient(120deg, #fb923c 0%, #ec4899 46%, #7c3aed 100%);
          box-shadow: 0 16px 36px rgba(139, 92, 246, 0.35), 0 6px 18px rgba(236, 72, 153, 0.25);
          animation: ctaGlow 2.4s ease-in-out infinite;
          overflow: hidden;
        }
        .cta-ripple {
          position: absolute;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          background: rgba(255,255,255,0.8);
          opacity: 0.45;
          animation: ctaRipple 520ms ease-out forwards;
        }
        .glass-success {
          backdrop-filter: blur(20px);
          background: linear-gradient(145deg, rgba(255,255,255,0.58), rgba(226,255,236,0.48));
          border: 1px solid rgba(167,243,208,0.75);
          box-shadow: 0 18px 36px rgba(34,197,94,0.17);
        }
        .glass-dock {
          backdrop-filter: blur(20px);
          background: rgba(255,255,255,0.28);
          border: 1px solid rgba(255,255,255,0.42);
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255,255,255,0.6);
        }
        .dock-btn {
          color: #334155;
          border-radius: 999px;
          padding: 8px;
          background: rgba(255,255,255,0.35);
          border: 1px solid rgba(255,255,255,0.4);
        }
        .blob-wave {
          position: absolute;
          filter: blur(50px);
          opacity: 0.4;
          border-radius: 999px;
          pointer-events: none;
        }
        .blob-wave-a {
          width: 260px;
          height: 260px;
          top: -60px;
          right: -80px;
          background: rgba(255,255,255,0.65);
          animation: blobFloatA 8s ease-in-out infinite;
        }
        .blob-wave-b {
          width: 300px;
          height: 220px;
          left: -90px;
          top: 38%;
          background: rgba(125,211,252,0.55);
          animation: blobFloatB 10s ease-in-out infinite;
        }
        .blob-wave-c {
          width: 280px;
          height: 180px;
          right: -70px;
          bottom: 12%;
          background: rgba(251,146,60,0.4);
          animation: blobFloatC 12s ease-in-out infinite;
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes starPulse {
          0% { transform: scale(0.92); }
          50% { transform: scale(1.12); }
          100% { transform: scale(1.05); }
        }
        @keyframes starSweep {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
        @keyframes ctaGlow {
          0%, 100% { box-shadow: 0 16px 36px rgba(139,92,246,0.35), 0 6px 18px rgba(236,72,153,0.25); }
          50% { box-shadow: 0 18px 40px rgba(249,115,22,0.32), 0 8px 22px rgba(236,72,153,0.3); }
        }
        @keyframes ctaRipple {
          from { transform: scale(0.6); opacity: 0.55; }
          to { transform: scale(16); opacity: 0; }
        }
        @keyframes blobFloatA {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(-18px, 14px, 0); }
        }
        @keyframes blobFloatB {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(20px, -10px, 0); }
        }
        @keyframes blobFloatC {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(-16px, -14px, 0); }
        }
      `})]}):e.jsx("div",{className:"min-h-screen bg-slate-950 p-4",children:e.jsxs("div",{className:"mx-auto w-full max-w-md rounded-[28px] border border-white/20 bg-white/20 p-8 text-center text-slate-900 backdrop-blur-2xl",children:[e.jsx("h1",{className:"text-xl font-bold",children:"Feedback linki etibarsızdır"}),e.jsx("p",{className:"mt-2 text-sm text-slate-600",children:"Bu səhifə yalnız çek üzərindəki QR linki (r+t) ilə açılmalıdır."})]})}):e.jsx("div",{className:"min-h-screen bg-slate-950 p-4",children:e.jsxs("div",{className:"mx-auto w-full max-w-md rounded-[28px] border border-white/20 bg-white/20 p-8 text-center text-slate-900 backdrop-blur-2xl",children:[e.jsx("h1",{className:"text-xl font-bold",children:"Tenant tapılmadı"}),e.jsx("p",{className:"mt-2 text-sm text-slate-600",children:"Feedback səhifəsi üçün tenant_id lazımdır."})]})})}export{Xe as default};
