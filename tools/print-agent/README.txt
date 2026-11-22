iRonWaves Print Agent — Windows 0.6.2

Quraşdırma: ironwaves-print-agent-setup.exe faylını açın. ZIP yükləmisinizsə,
əvvəl arxivi çıxarın; setup.bat və ya setup-windows.ps1 eyni installer-i açır.
Admin hüququ və ayrıca Node.js quraşdırılması lazım deyil.

Yeniləmə: setup-u birbaşa başladın. Quraşdırıcı əvvəlcə çap işlərinin
bitməsini gözləyir, yalnız öz agent prosesini dayandırır, sonra yenisini
quraşdırır. Aktiv iş bitməzsə xəbərdarlıq göstərir; printer növbələri,
printer adları, tenant ayarları və əvvəlki job jurnalı saxlanılır.
Quraşdırma bitdikdə Start iRonWaves Print Agent seçimi agenti səssiz açır.
Windows-a girişdə agent istifadəçinin HKCU Run qeydi vasitəsilə açılır.

0.6.2 — çap işi qorunması və RAW növbələri

- POST /print-raw və /print-html üçün optional job_id: 16–100 ASCII hərf/rəqəm/_/-.
- Eyni işi təkrar göndərərkən eyni job_id və eyni məzmunu istifadə edin. Agent işi ikinci dəfə göndərmir. Eyni ID + başqa məzmun HTTP 409 qaytarır.
- Yeni protokol HTTP 202 + {ok:true,job:{job_id,status}} qaytarır. Bu, kağızın çap olunduğunu təsdiqləmir. GET /jobs/{job_id} ilə status yoxlanır: queued, processing, submitted, unknown. submitted spool əməliyyatının bitməsidir, fiziki kağız sensorunun təsdiqi deyil.
- İşə aid hash/status qeydləri istifadəçinin home qovluğundakı .ironwaves-print/jobs-v1 daxilində saxlanılır; çekin məzmunu saxlanılmır. Terminal qeydlər 7 gün saxlanır, maksimum 10000 qeyd. Disk/jurnal xətası və doluluq zamanı agent yeni işi göndərmədən xəta verir. queued/processing işlər restart-dan sonra unknown sayılır və avtomatik təkrarlanmır.
- Unknown işi görən istifadəçi əvvəlcə printer/spooler növbəsini yoxlamalıdır. Şüurlu manual təkrar çap yeni ID alır. Bu, printerdən fiziki təsdiq olmadan “exactly once paper output” zəmanəti deyil.
- RAW işləri həll edilmiş printer adına görə ardıcıl, fərqli printerlərə isə paralel göndərilir. HTML çapları default printeri dəyişdirdiyinə görə qlobal HTML kilidi qalır. HTML və RAW eyni printerdə bir-birini gözləyir.
- Köhnə job_id-siz sorğular əvvəlki sinxron API ilə işləyir, lakin onların HTTP təkrarları yeni job protokolunun qorumasına daxil deyil.
- Frontend RAW/browser paralel çapını və qeyri-müəyyən POST cavabından sonra başqa çap mühərrikinə keçidi dayandırır. Köhnə agentlə işləyə bilir, amma restart-dan sonra iş ID qorunması üçün yeni agent lazımdır. KDS avtomatik işi üçün tenant origin + dedupe açarından sabit ID yaradılır; ayrı cihazlarda ayrı agentlər arasında koordinasiya edilmir.
- Windows-da tətbiq etmək üçün yeni agent paketi ayrıca qurulub yoxlanmalıdır. Frontend deploy-u quraşdırılmış Windows agentini dəyişmir. Mövcud printer adları və seçimləri migration tələb etmir.

Yoxlama: layihənin kökündə npm run test:print; npm run typecheck; npm run build.
Testlər OS çapını imitasiya edir, işləyən agenti dayandırmır və real çek çap etmir.
