/**
 * Backend error message localization for staff-facing UI.
 * Maps common English backend error messages to user-friendly Azerbaijani equivalents.
 */

const ERROR_MAP: Array<{ pattern: RegExp; az: string }> = [
  // Table/Session errors
  { pattern: /table not found/i, az: 'Masa tapılmadı' },
  { pattern: /table already exists/i, az: 'Bu adda masa artıq mövcuddur' },
  { pattern: /table already has an active session/i, az: 'Bu masada artıq aktiv sessiya var' },
  { pattern: /table does not have an active session/i, az: 'Bu masada aktiv sessiya yoxdur' },
  { pattern: /table label is required/i, az: 'Masa adı boş ola bilməz' },
  { pattern: /dirty table cannot be assigned/i, az: 'Təmizlənməmiş masa təyin edilə bilməz' },

  // Check/Order errors
  { pattern: /open check not found/i, az: 'Açıq hesab tapılmadı' },
  { pattern: /check does not have an active session/i, az: 'Hesabın aktiv sessiyası yoxdur' },
  { pattern: /no draft items to send/i, az: 'Göndəriləcək sifariş yoxdur — əvvəlcə məhsul əlavə edin' },
  { pattern: /only draft items can be edited/i, az: 'Yalnız göndərilməmiş məhsullar redaktə oluna bilər' },
  { pattern: /only draft items can be removed/i, az: 'Yalnız göndərilməmiş məhsullar silinə bilər' },
  { pattern: /order item not found/i, az: 'Sifariş maddəsi tapılmadı' },
  { pattern: /payment parts must match/i, az: 'Ödəniş hissələrinin cəmi hesab məbləğinə bərabər olmalıdır' },

  // Permission errors
  { pattern: /restaurant access required/i, az: 'Restoran bölməsinə giriş icazəsi yoxdur' },
  { pattern: /manager override required/i, az: 'Bu əməliyyat üçün manager/admin icazəsi lazımdır' },
  { pattern: /table is locked by another user/i, az: 'Bu masa başqa istifadəçi tərəfindən istifadə olunur' },
  { pattern: /write access denied/i, az: 'Bu masaya yazma icazəniz yoxdur' },
  { pattern: /invalid manager password/i, az: 'Manager/Admin şifrəsi yanlışdır' },
  { pattern: /active sales shift required/i, az: 'Əvvəlcə satış növbəsi açılmalıdır' },
  { pattern: /no active shift/i, az: 'Aktiv növbə yoxdur — əvvəlcə növbə açın' },

  // Reservation errors
  { pattern: /table already has a conflicting reservation/i, az: 'Bu masada eyni vaxtda başqa rezervasiya var' },
  { pattern: /reservation not found/i, az: 'Rezervasiya tapılmadı' },
  { pattern: /assigned table not found/i, az: 'Təyin edilmiş masa tapılmadı' },

  // Floor plan errors
  { pattern: /floor plan not found/i, az: 'Mərtəbə planı tapılmadı' },

  // Kitchen errors
  { pattern: /round not found/i, az: 'Raund tapılmadı' },

  // Generic
  { pattern: /not found/i, az: 'Tapılmadı' },
  { pattern: /internal server error/i, az: 'Server xətası baş verdi. Bir az sonra yenidən cəhd edin.' },
];

/**
 * Localizes a backend error message to Azerbaijani.
 * If no match is found, strips the request_id suffix and returns the original.
 */
export function localizeError(message: string | null | undefined): string {
  if (!message) return 'Naməlum xəta';
  const cleaned = String(message).replace(/\s*\(request_id:\s*[^)]+\)\s*$/, '').trim();

  for (const entry of ERROR_MAP) {
    if (entry.pattern.test(cleaned)) {
      return entry.az;
    }
  }

  return cleaned;
}
