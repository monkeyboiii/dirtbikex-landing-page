import { lookupInvite, type LookupResult } from './_lib/inviteLookup';
import { lookupUser, type UserLookupResult } from './_lib/userLookup';
import { lookupEvent, type EventLookupResult } from './_lib/eventLookup';
import { renderShareLanding } from './_lib/render';
import { fetchForumMetrics } from './_lib/forumMetrics';
import { fetchForumFeatured } from './_lib/forumFeatured';
import { fetchSponsors, fetchLeaderboard } from './_lib/sponsorProxy';
import { handleLogtoSms } from './_lib/logtoSms';
import { handleOutreachTest, handleBatch, handlePreview, handleStatus, handleMetrics, handleUnsub, handleDrip, handleWebhook, runDrip } from './_lib/outreach';
import { handleJoinSubmit, handleJoinConfirm, handleUnsubscribe, handleCodePrecheck } from './_lib/join';
import { handleShortlinkResolve } from './_lib/shortlink';
import type { Lang, PagesEnv, ShareLandingProps } from './_lib/types';

interface Env extends PagesEnv {
  /** Static-assets binding (serves files from `dist/`). Minimal inline shape — */
  /** matches the existing `PagesEnv` convention of avoiding @cloudflare/workers-types. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Mirrors the placeholder in `src/config.ts`. The worker is bundled separately
 * from the Astro app and can't import `src/`. Replace both copies when the real
 * App Store ID lands; alternatively promote to an `APP_STORE_URL` env var.
 */
const APP_STORE_URL = 'https://apps.apple.com/app/id6765577701';

interface Copy {
  ctaLabel: string;
  /** Desktop CTA label — there's no app to install, so the button opens the
   *  forum's web invite-accept page instead (see `buildProps` valid case). */
  webCtaLabel: string;
  /** Secondary mobile CTA — deep-links into the app (funnels the invite). */
  openInAppLabel: string;
  returnTap: string;
  expiredTitle: string;
  expiredSubtitle: string;
  notFoundTitle: string;
  notFoundSubtitle: string;
  fallbackTitle: string;
}

// Locales not present here fall back to `en` via `getCopy()`. Add more
// translations in-place; the translation pipeline that fans out
// `src/i18n/locales/*.json` doesn't currently cover this worker-side copy.
const COPY: Partial<Record<Lang, Copy>> = {
  en: {
    ctaLabel: 'Get DirtBikeX',
    webCtaLabel: 'Open in browser',
    openInAppLabel: 'Open in the app',
    returnTap: 'Just installed? Tap Open in the app to finish joining.',
    expiredTitle: 'This invite has expired',
    expiredSubtitle: 'Get the app to join DirtBikeX.',
    notFoundTitle: 'Check your invite link',
    notFoundSubtitle: 'You may have the wrong invite key — but you can still join DirtBikeX.',
    fallbackTitle: 'Get DirtBikeX',
  },
  'zh-CN': {
    ctaLabel: '下载 DirtBikeX',
    webCtaLabel: '在浏览器中打开',
    openInAppLabel: '在应用中打开',
    returnTap: '刚安装好？点按“在应用中打开”即可完成加入。',
    expiredTitle: '邀请已过期',
    expiredSubtitle: '下载应用，加入 DirtBikeX。',
    notFoundTitle: '请检查邀请链接',
    notFoundSubtitle: '邀请密钥可能有误——但你仍然可以加入 DirtBikeX。',
    fallbackTitle: '下载 DirtBikeX',
  },
  'zh-TW': {
    ctaLabel: '下載 DirtBikeX',
    webCtaLabel: '在瀏覽器中開啟',
    openInAppLabel: '在 App 中開啟',
    returnTap: '剛安裝好？點按「在 App 中開啟」即可完成加入。',
    expiredTitle: '邀請已過期',
    expiredSubtitle: '下載 App，加入 DirtBikeX。',
    notFoundTitle: '請檢查邀請連結',
    notFoundSubtitle: '邀請金鑰可能有誤——但你仍然可以加入 DirtBikeX。',
    fallbackTitle: '下載 DirtBikeX',
  },
  ja: {
    ctaLabel: 'DirtBikeX を入手',
    webCtaLabel: 'ブラウザで開く',
    openInAppLabel: 'アプリで開く',
    returnTap: 'インストールしたばかりですか？「アプリで開く」をタップして参加を完了しましょう。',
    expiredTitle: 'この招待は有効期限が切れています',
    expiredSubtitle: 'アプリを入手して DirtBikeX に参加しましょう。',
    notFoundTitle: '招待リンクをご確認ください',
    notFoundSubtitle: '招待キーが間違っているかもしれません。それでも DirtBikeX に参加できます。',
    fallbackTitle: 'DirtBikeX を入手',
  },
  ko: {
    ctaLabel: 'DirtBikeX 받기',
    webCtaLabel: '브라우저에서 열기',
    openInAppLabel: '앱에서 열기',
    returnTap: '방금 설치하셨나요? ‘앱에서 열기’를 눌러 참여를 완료하세요.',
    expiredTitle: '이 초대가 만료되었습니다',
    expiredSubtitle: '앱을 받아 DirtBikeX에 참여하세요.',
    notFoundTitle: '초대 링크를 확인해 주세요',
    notFoundSubtitle: '초대 키가 잘못되었을 수 있어요. 그래도 DirtBikeX에 참여할 수 있습니다.',
    fallbackTitle: 'DirtBikeX 받기',
  },
  de: {
    ctaLabel: 'DirtBikeX holen',
    webCtaLabel: 'Im Browser öffnen',
    openInAppLabel: 'In der App öffnen',
    returnTap: 'Gerade installiert? Tippe auf „In der App öffnen“, um beizutreten.',
    expiredTitle: 'Diese Einladung ist abgelaufen',
    expiredSubtitle: 'Hol dir die App, um DirtBikeX beizutreten.',
    notFoundTitle: 'Prüf deinen Einladungslink',
    notFoundSubtitle: 'Der Einladungsschlüssel ist vielleicht falsch – aber du kannst DirtBikeX trotzdem beitreten.',
    fallbackTitle: 'DirtBikeX holen',
  },
  it: {
    ctaLabel: 'Scarica DirtBikeX',
    webCtaLabel: 'Apri nel browser',
    openInAppLabel: "Apri nell'app",
    returnTap: "Appena installata? Tocca “Apri nell'app” per completare l'iscrizione.",
    expiredTitle: 'Questo invito è scaduto',
    expiredSubtitle: "Scarica l'app per unirti a DirtBikeX.",
    notFoundTitle: "Controlla il link d'invito",
    notFoundSubtitle: "La chiave d'invito potrebbe essere errata, ma puoi comunque unirti a DirtBikeX.",
    fallbackTitle: 'Scarica DirtBikeX',
  },
  fr: {
    ctaLabel: 'Télécharger DirtBikeX',
    webCtaLabel: 'Ouvrir dans le navigateur',
    openInAppLabel: "Ouvrir dans l'app",
    returnTap: "Vous venez de l'installer ? Touchez « Ouvrir dans l'app » pour terminer.",
    expiredTitle: 'Cette invitation a expiré',
    expiredSubtitle: "Téléchargez l'app pour rejoindre DirtBikeX.",
    notFoundTitle: "Vérifiez votre lien d'invitation",
    notFoundSubtitle: "La clé d'invitation est peut-être incorrecte, mais vous pouvez quand même rejoindre DirtBikeX.",
    fallbackTitle: 'Télécharger DirtBikeX',
  },
  es: {
    ctaLabel: 'Descargar DirtBikeX',
    webCtaLabel: 'Abrir en el navegador',
    openInAppLabel: 'Abrir en la app',
    returnTap: '¿Acabas de instalarla? Toca “Abrir en la app” para completar tu ingreso.',
    expiredTitle: 'Esta invitación ha caducado',
    expiredSubtitle: 'Descarga la app para unirte a DirtBikeX.',
    notFoundTitle: 'Revisa tu enlace de invitación',
    notFoundSubtitle: 'Puede que la clave de invitación sea incorrecta, pero aún puedes unirte a DirtBikeX.',
    fallbackTitle: 'Descargar DirtBikeX',
  },
  ar: {
    ctaLabel: 'احصل على DirtBikeX',
    webCtaLabel: 'افتح في المتصفح',
    openInAppLabel: 'افتح في التطبيق',
    returnTap: 'ثبّتّه للتو؟ اضغط على «افتح في التطبيق» لإكمال الانضمام.',
    expiredTitle: 'انتهت صلاحية هذه الدعوة',
    expiredSubtitle: 'احصل على التطبيق للانضمام إلى DirtBikeX.',
    notFoundTitle: 'تحقّق من رابط الدعوة',
    notFoundSubtitle: 'قد يكون مفتاح الدعوة غير صحيح — لكن لا يزال بإمكانك الانضمام إلى DirtBikeX.',
    fallbackTitle: 'احصل على DirtBikeX',
  },
  da: {
    ctaLabel: 'Hent DirtBikeX',
    webCtaLabel: 'Åbn i browseren',
    openInAppLabel: 'Åbn i appen',
    returnTap: 'Lige installeret? Tryk på “Åbn i appen” for at gøre det færdigt.',
    expiredTitle: 'Denne invitation er udløbet',
    expiredSubtitle: 'Hent appen for at deltage i DirtBikeX.',
    notFoundTitle: 'Tjek dit invitationslink',
    notFoundSubtitle: 'Invitationsnøglen er måske forkert – men du kan stadig være med i DirtBikeX.',
    fallbackTitle: 'Hent DirtBikeX',
  },
  el: {
    ctaLabel: 'Λήψη του DirtBikeX',
    webCtaLabel: 'Άνοιγμα στο πρόγραμμα περιήγησης',
    openInAppLabel: 'Άνοιγμα στην εφαρμογή',
    returnTap: 'Μόλις την εγκατέστησες; Πάτησε «Άνοιγμα στην εφαρμογή» για να ολοκληρώσεις.',
    expiredTitle: 'Αυτή η πρόσκληση έχει λήξει',
    expiredSubtitle: 'Κατέβασε την εφαρμογή για να μπεις στο DirtBikeX.',
    notFoundTitle: 'Έλεγξε τον σύνδεσμο πρόσκλησης',
    notFoundSubtitle: 'Το κλειδί πρόσκλησης μπορεί να είναι λάθος — αλλά μπορείς ακόμα να μπεις στο DirtBikeX.',
    fallbackTitle: 'Λήψη του DirtBikeX',
  },
  'fa-IR': {
    ctaLabel: 'دریافت DirtBikeX',
    webCtaLabel: 'باز کردن در مرورگر',
    openInAppLabel: 'باز کردن در اپ',
    returnTap: 'همین حالا نصب کردید؟ روی «باز کردن در اپ» بزنید تا عضویت کامل شود.',
    expiredTitle: 'این دعوت منقضی شده است',
    expiredSubtitle: 'برای پیوستن به DirtBikeX اپ را دریافت کنید.',
    notFoundTitle: 'پیوند دعوت را بررسی کنید',
    notFoundSubtitle: 'ممکن است کلید دعوت اشتباه باشد — اما همچنان می‌توانید به DirtBikeX بپیوندید.',
    fallbackTitle: 'دریافت DirtBikeX',
  },
  fi: {
    ctaLabel: 'Hanki DirtBikeX',
    webCtaLabel: 'Avaa selaimessa',
    openInAppLabel: 'Avaa sovelluksessa',
    returnTap: 'Asensitko juuri? Viimeistele liittyminen napauttamalla “Avaa sovelluksessa”.',
    expiredTitle: 'Tämä kutsu on vanhentunut',
    expiredSubtitle: 'Hanki sovellus ja liity DirtBikeX-yhteisöön.',
    notFoundTitle: 'Tarkista kutsulinkkisi',
    notFoundSubtitle: 'Kutsuavain voi olla väärä – mutta voit silti liittyä DirtBikeX-yhteisöön.',
    fallbackTitle: 'Hanki DirtBikeX',
  },
  id: {
    ctaLabel: 'Unduh DirtBikeX',
    webCtaLabel: 'Buka di browser',
    openInAppLabel: 'Buka di aplikasi',
    returnTap: 'Baru memasang? Ketuk “Buka di aplikasi” untuk menyelesaikan.',
    expiredTitle: 'Undangan ini telah kedaluwarsa',
    expiredSubtitle: 'Unduh aplikasi untuk bergabung dengan DirtBikeX.',
    notFoundTitle: 'Periksa tautan undanganmu',
    notFoundSubtitle: 'Kunci undangan mungkin salah — tetapi kamu tetap bisa bergabung dengan DirtBikeX.',
    fallbackTitle: 'Unduh DirtBikeX',
  },
  nl: {
    ctaLabel: 'Download DirtBikeX',
    webCtaLabel: 'Openen in browser',
    openInAppLabel: 'Openen in de app',
    returnTap: 'Net geïnstalleerd? Tik op “Openen in de app” om je aanmelding te voltooien.',
    expiredTitle: 'Deze uitnodiging is verlopen',
    expiredSubtitle: 'Download de app om lid te worden van DirtBikeX.',
    notFoundTitle: 'Controleer je uitnodigingslink',
    notFoundSubtitle: 'De uitnodigingssleutel klopt mogelijk niet — maar je kunt nog steeds lid worden van DirtBikeX.',
    fallbackTitle: 'Download DirtBikeX',
  },
  pt: {
    ctaLabel: 'Baixar o DirtBikeX',
    webCtaLabel: 'Abrir no navegador',
    openInAppLabel: 'Abrir no app',
    returnTap: 'Acabou de instalar? Toque em “Abrir no app” para concluir.',
    expiredTitle: 'Este convite expirou',
    expiredSubtitle: 'Baixe o app para entrar no DirtBikeX.',
    notFoundTitle: 'Verifique seu link de convite',
    notFoundSubtitle: 'A chave de convite pode estar incorreta — mas você ainda pode entrar no DirtBikeX.',
    fallbackTitle: 'Baixar o DirtBikeX',
  },
  'tr-TR': {
    ctaLabel: "DirtBikeX'i indir",
    webCtaLabel: 'Tarayıcıda aç',
    openInAppLabel: 'Uygulamada aç',
    returnTap: 'Yeni mi yükledin? Katılmak için “Uygulamada aç”a dokun.',
    expiredTitle: 'Bu davetin süresi dolmuş',
    expiredSubtitle: "DirtBikeX'e katılmak için uygulamayı indir.",
    notFoundTitle: 'Davet bağlantını kontrol et',
    notFoundSubtitle: "Davet anahtarı yanlış olabilir — ama yine de DirtBikeX'e katılabilirsin.",
    fallbackTitle: "DirtBikeX'i indir",
  },
  th: {
    ctaLabel: 'ดาวน์โหลด DirtBikeX',
    webCtaLabel: 'เปิดในเบราว์เซอร์',
    openInAppLabel: 'เปิดในแอป',
    returnTap: 'เพิ่งติดตั้งใช่ไหม? แตะ “เปิดในแอป” เพื่อเข้าร่วมให้เสร็จ',
    expiredTitle: 'คำเชิญนี้หมดอายุแล้ว',
    expiredSubtitle: 'ดาวน์โหลดแอปเพื่อเข้าร่วม DirtBikeX',
    notFoundTitle: 'ตรวจสอบลิงก์คำเชิญของคุณ',
    notFoundSubtitle: 'คีย์คำเชิญอาจไม่ถูกต้อง แต่คุณยังเข้าร่วม DirtBikeX ได้',
    fallbackTitle: 'ดาวน์โหลด DirtBikeX',
  },
  vi: {
    ctaLabel: 'Tải DirtBikeX',
    webCtaLabel: 'Mở trong trình duyệt',
    openInAppLabel: 'Mở trong ứng dụng',
    returnTap: 'Vừa cài xong? Nhấn “Mở trong ứng dụng” để hoàn tất tham gia.',
    expiredTitle: 'Lời mời này đã hết hạn',
    expiredSubtitle: 'Tải app để tham gia DirtBikeX.',
    notFoundTitle: 'Kiểm tra liên kết lời mời của bạn',
    notFoundSubtitle: 'Có thể khóa lời mời không đúng — nhưng bạn vẫn có thể tham gia DirtBikeX.',
    fallbackTitle: 'Tải DirtBikeX',
  },
  sv: {
    ctaLabel: 'Hämta DirtBikeX',
    webCtaLabel: 'Öppna i webbläsaren',
    openInAppLabel: 'Öppna i appen',
    returnTap: 'Nyss installerat? Tryck på “Öppna i appen” för att slutföra.',
    expiredTitle: 'Den här inbjudan har gått ut',
    expiredSubtitle: 'Hämta appen för att gå med i DirtBikeX.',
    notFoundTitle: 'Kontrollera din inbjudningslänk',
    notFoundSubtitle: 'Inbjudningsnyckeln kan vara fel – men du kan ändå gå med i DirtBikeX.',
    fallbackTitle: 'Hämta DirtBikeX',
  },
};

function getCopy(locale: Lang): Copy {
  return COPY[locale] ?? COPY.en!;
}

/** Profile not-found copy (`/s/u/<username>`). Falls back to `en`. */
const USER_NOT_FOUND: Partial<Record<Lang, { title: string; subtitle: string }>> = {
  en: { title: 'Rider not found', subtitle: 'This profile may have moved — but you can still join DirtBikeX.' },
  'zh-CN': { title: '未找到该用户', subtitle: '该主页可能已变更——但你仍然可以加入 DirtBikeX。' },
  'zh-TW': { title: '找不到該用戶', subtitle: '此主頁可能已變更——但你仍然可以加入 DirtBikeX。' },
  ja: { title: 'ライダーが見つかりません', subtitle: 'このプロフィールは移動した可能性があります。それでも DirtBikeX に参加できます。' },
  ko: { title: '라이더를 찾을 수 없습니다', subtitle: '이 프로필은 이동했을 수 있어요. 그래도 DirtBikeX에 참여할 수 있습니다.' },
  de: { title: 'Fahrer nicht gefunden', subtitle: 'Dieses Profil wurde vielleicht verschoben – aber du kannst DirtBikeX trotzdem beitreten.' },
  it: { title: 'Rider non trovato', subtitle: 'Questo profilo potrebbe essere stato spostato, ma puoi comunque unirti a DirtBikeX.' },
  fr: { title: 'Pilote introuvable', subtitle: 'Ce profil a peut-être été déplacé, mais vous pouvez quand même rejoindre DirtBikeX.' },
  es: { title: 'Piloto no encontrado', subtitle: 'Es posible que este perfil se haya movido, pero aún puedes unirte a DirtBikeX.' },
  ar: { title: 'لم يتم العثور على الدراج', subtitle: 'ربما تم نقل هذا الملف الشخصي — لكن لا يزال بإمكانك الانضمام إلى DirtBikeX.' },
  da: { title: 'Rytter ikke fundet', subtitle: 'Denne profil er måske flyttet – men du kan stadig være med i DirtBikeX.' },
  el: { title: 'Ο αναβάτης δεν βρέθηκε', subtitle: 'Αυτό το προφίλ μπορεί να έχει μετακινηθεί — αλλά μπορείς ακόμα να μπεις στο DirtBikeX.' },
  'fa-IR': { title: 'موتورسوار پیدا نشد', subtitle: 'ممکن است این نمایه منتقل شده باشد — اما همچنان می‌توانید به DirtBikeX بپیوندید.' },
  fi: { title: 'Kuljettajaa ei löytynyt', subtitle: 'Tämä profiili on ehkä siirretty – mutta voit silti liittyä DirtBikeX-yhteisöön.' },
  id: { title: 'Rider tidak ditemukan', subtitle: 'Profil ini mungkin telah dipindahkan — tetapi kamu tetap bisa bergabung dengan DirtBikeX.' },
  nl: { title: 'Rijder niet gevonden', subtitle: 'Dit profiel is mogelijk verplaatst — maar je kunt nog steeds lid worden van DirtBikeX.' },
  pt: { title: 'Piloto não encontrado', subtitle: 'Este perfil pode ter sido movido — mas você ainda pode entrar no DirtBikeX.' },
  'tr-TR': { title: 'Sürücü bulunamadı', subtitle: 'Bu profil taşınmış olabilir — ama yine de DirtBikeX\'e katılabilirsin.' },
  th: { title: 'ไม่พบนักขี่', subtitle: 'โปรไฟล์นี้อาจถูกย้าย — แต่คุณยังเข้าร่วม DirtBikeX ได้' },
  vi: { title: 'Không tìm thấy tay đua', subtitle: 'Hồ sơ này có thể đã được chuyển — nhưng bạn vẫn có thể tham gia DirtBikeX.' },
  sv: { title: 'Föraren hittades inte', subtitle: 'Den här profilen kan ha flyttats – men du kan fortfarande gå med i DirtBikeX.' },
};

function getUserNotFound(locale: Lang): { title: string; subtitle: string } {
  return USER_NOT_FOUND[locale] ?? USER_NOT_FOUND.en!;
}

/** Event not-found copy (`/s/e/<id>`). Falls back to `en`. */
const EVENT_NOT_FOUND: Partial<Record<Lang, { title: string; subtitle: string }>> = {
  en: { title: 'Event not found', subtitle: 'This event may have ended or moved — but you can still join DirtBikeX.' },
  'zh-CN': { title: '未找到该活动', subtitle: '该活动可能已结束或变更——但你仍然可以加入 DirtBikeX。' },
  'zh-TW': { title: '找不到該活動', subtitle: '此活動可能已結束或變更——但你仍然可以加入 DirtBikeX。' },
  ja: { title: 'イベントが見つかりません', subtitle: 'このイベントは終了または移動した可能性があります。それでも DirtBikeX に参加できます。' },
  ko: { title: '이벤트를 찾을 수 없습니다', subtitle: '이 이벤트는 종료되었거나 이동했을 수 있어요. 그래도 DirtBikeX에 참여할 수 있습니다.' },
  de: { title: 'Veranstaltung nicht gefunden', subtitle: 'Diese Veranstaltung wurde vielleicht beendet oder verschoben – aber du kannst DirtBikeX trotzdem beitreten.' },
  it: { title: 'Evento non trovato', subtitle: 'Questo evento potrebbe essere terminato o spostato, ma puoi comunque unirti a DirtBikeX.' },
  fr: { title: 'Événement introuvable', subtitle: 'Cet événement est peut-être terminé ou a été déplacé, mais vous pouvez quand même rejoindre DirtBikeX.' },
  es: { title: 'Evento no encontrado', subtitle: 'Es posible que este evento haya terminado o se haya movido, pero aún puedes unirte a DirtBikeX.' },
  ar: { title: 'لم يتم العثور على الفعالية', subtitle: 'ربما انتهت هذه الفعالية أو تم نقلها — لكن لا يزال بإمكانك الانضمام إلى DirtBikeX.' },
  da: { title: 'Begivenhed ikke fundet', subtitle: 'Denne begivenhed er måske afsluttet eller flyttet – men du kan stadig være med i DirtBikeX.' },
  el: { title: 'Η εκδήλωση δεν βρέθηκε', subtitle: 'Αυτή η εκδήλωση μπορεί να έχει λήξει ή να έχει μετακινηθεί — αλλά μπορείς ακόμα να μπεις στο DirtBikeX.' },
  'fa-IR': { title: 'رویداد پیدا نشد', subtitle: 'ممکن است این رویداد به پایان رسیده یا منتقل شده باشد — اما همچنان می‌توانید به DirtBikeX بپیوندید.' },
  fi: { title: 'Tapahtumaa ei löytynyt', subtitle: 'Tämä tapahtuma on ehkä päättynyt tai siirretty – mutta voit silti liittyä DirtBikeX-yhteisöön.' },
  id: { title: 'Acara tidak ditemukan', subtitle: 'Acara ini mungkin telah berakhir atau dipindahkan — tetapi kamu tetap bisa bergabung dengan DirtBikeX.' },
  nl: { title: 'Evenement niet gevonden', subtitle: 'Dit evenement is mogelijk afgelopen of verplaatst — maar je kunt nog steeds lid worden van DirtBikeX.' },
  pt: { title: 'Evento não encontrado', subtitle: 'Este evento pode ter terminado ou sido movido — mas você ainda pode entrar no DirtBikeX.' },
  th: { title: 'ไม่พบกิจกรรม', subtitle: 'กิจกรรมนี้อาจสิ้นสุดหรือถูกย้าย — แต่คุณยังเข้าร่วม DirtBikeX ได้' },
  'tr-TR': { title: 'Etkinlik bulunamadı', subtitle: 'Bu etkinlik sona ermiş veya taşınmış olabilir — ama yine de DirtBikeX\'e katılabilirsin.' },
  vi: { title: 'Không tìm thấy sự kiện', subtitle: 'Sự kiện này có thể đã kết thúc hoặc được chuyển — nhưng bạn vẫn có thể tham gia DirtBikeX.' },
  sv: { title: 'Evenemanget hittades inte', subtitle: 'Det här evenemanget kan ha avslutats eller flyttats – men du kan fortfarande gå med i DirtBikeX.' },
};

function getEventNotFound(locale: Lang): { title: string; subtitle: string } {
  return EVENT_NOT_FOUND[locale] ?? EVENT_NOT_FOUND.en!;
}

const LOCALES: readonly Lang[] = [
  'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'it', 'fr', 'es', 'ar',
  'da', 'el', 'fa-IR', 'fi', 'id', 'nl', 'pt', 'tr-TR', 'th', 'vi', 'sv',
];

/**
 * Resolve a locale for `/s/i/<key>` (and any future `/s/<kind>/<token>` page).
 * `?lang=` wins so a shared URL like `/s/i/<key>?lang=zh-CN` renders
 * deterministically — and the URL pattern stays under `/s/*` (path unchanged),
 * preserving the AASA universal-link contract.
 */
function pickLocale(url: URL, acceptLanguage: string | null): Lang {
  // `?lang=auto` is the iOS share-link default (ShareLookup.shareURL) — it
  // explicitly defers to Accept-Language negotiation below. Any other value
  // pins the card; matched leniently via `matchTag` so `?lang=zh-cn`, `zh`,
  // or `ZH_CN` all resolve like `zh-CN` (case/format no longer has to be exact).
  const qs = url.searchParams.get('lang');
  if (qs && qs !== 'auto') {
    const pinned = matchTag(qs);
    if (pinned) return pinned;
  }

  if (!acceptLanguage) return 'en';
  const tags = acceptLanguage
    .split(',')
    .map((t) => t.trim().split(';')[0]!.trim())
    .filter(Boolean);
  for (const raw of tags) {
    const m = matchTag(raw);
    if (m) return m;
  }
  return 'en';
}

/**
 * Resolve one BCP-47-ish tag to a supported `Lang`, or null. Case-insensitive;
 * accepts `-` or `_` separators; falls back to the base language (`en-GB` → `en`)
 * and maps any `zh` variant to `zh-TW` (Traditional) or `zh-CN` (Simplified).
 */
function matchTag(tag: string): Lang | null {
  const lower = tag.toLowerCase();
  const exact = LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split(/[-_]/)[0]!;
  if (base === 'zh') {
    const want: Lang = /hant|tw|hk|mo/.test(lower) ? 'zh-TW' : 'zh-CN';
    if (LOCALES.includes(want)) return want;
  }
  return LOCALES.find((l) => l.toLowerCase().split('-')[0] === base) ?? null;
}

/**
 * Coarse server-side device split for the CTA. Mobile (iOS/Android) keeps the
 * App Store CTA + the install→re-tap return path; desktop has no app to install,
 * so the valid-invite CTA points at the forum's web accept page instead. `/s/*`
 * is `no-store` (public/_headers), so per-UA branching can't be poisoned by an
 * edge cache serving one device's variant to the other.
 */
function isDesktopUA(ua: string | null): boolean {
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(ua ?? '');
}

function buildProps(
  result: LookupResult,
  copy: Copy,
  locale: Lang,
  forumBase: string,
  desktop: boolean,
): { props: ShareLandingProps; cacheControl?: string } {
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase'> = {
    kind: 'i',
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
  };

  const errorCTA = desktop && forumBase
    ? { label: copy.webCtaLabel, url: forumBase }
    : base.primaryCTA;

  switch (result.status) {
    case 'valid': {
      // Desktop has no app: single CTA to the forum's web invite-accept page.
      if (desktop) {
        const primaryCTA = { label: copy.webCtaLabel, url: `${forumBase}/invites/${result.invite.invite_key}` };
        return { props: { ...base, primaryCTA, invite: result.invite } };
      }
      // Mobile: App Store primary ("Get DirtBikeX") + an "open in the app" deep
      // link that funnels the invite into the app for users who already have it
      // (the install→return path the returnTap helper describes).
      const appCTA = { label: copy.openInAppLabel, url: `dirtbikex://s/i/${result.invite.invite_key}` };
      return { props: { ...base, appCTA, invite: result.invite } };
    }
    // Error states carry no invite key, so desktop "open in browser" goes to
    // the forum home (not /invites/<key>); mobile keeps the App Store CTA.
    case 'expired':
      return {
        props: { ...base, primaryCTA: errorCTA, title: copy.expiredTitle, subtitle: copy.expiredSubtitle },
        cacheControl: 'no-cache',
      };
    case 'not_found':
      return {
        props: { ...base, primaryCTA: errorCTA, title: copy.notFoundTitle, subtitle: copy.notFoundSubtitle },
        cacheControl: 'no-cache',
      };
    case 'unreachable':
      return {
        props: { ...base, primaryCTA: errorCTA, title: copy.fallbackTitle },
        cacheControl: 'no-cache',
      };
  }
}

async function handleInvite(request: Request, env: Env, key: string): Promise<Response> {
  const url = new URL(request.url);
  const locale = pickLocale(url, request.headers.get('accept-language'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';

  const result = await lookupInvite(env, key);
  const desktop = isDesktopUA(request.headers.get('user-agent'));
  const { props, cacheControl } = buildProps(result, copy, locale, forumBase, desktop);
  return renderShareLanding(props, request.url, cacheControl ? { cacheControl } : {});
}

function buildUserProps(
  result: UserLookupResult,
  copy: Copy,
  locale: Lang,
  forumBase: string,
  desktop: boolean,
  username: string,
): { props: ShareLandingProps; cacheControl?: string } {
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase'> = {
    kind: 'u',
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
  };

  // Desktop has no app: point both the valid and error CTA at the forum profile page.
  const forumProfileCTA = { label: copy.webCtaLabel, url: forumBase ? `${forumBase}/u/${username}` : APP_STORE_URL };

  switch (result.status) {
    case 'valid': {
      if (desktop) {
        return { props: { ...base, primaryCTA: forumProfileCTA, user: result.user } };
      }
      // Mobile: App Store primary + an "open in the app" deep link that funnels
      // users who already have the app straight to the in-app profile.
      const appCTA = { label: copy.openInAppLabel, url: `dirtbikex://s/u/${username}` };
      return { props: { ...base, appCTA, user: result.user } };
    }
    case 'not_found': {
      const nf = getUserNotFound(locale);
      return {
        props: {
          ...base,
          primaryCTA: desktop && forumBase ? forumProfileCTA : base.primaryCTA,
          title: nf.title,
          subtitle: nf.subtitle,
        },
        cacheControl: 'no-cache',
      };
    }
    case 'unreachable':
      return {
        props: {
          ...base,
          primaryCTA: desktop && forumBase ? forumProfileCTA : base.primaryCTA,
          title: copy.fallbackTitle,
        },
        cacheControl: 'no-cache',
      };
  }
}

async function handleUser(request: Request, env: Env, username: string): Promise<Response> {
  const url = new URL(request.url);
  const locale = pickLocale(url, request.headers.get('accept-language'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';

  const result = await lookupUser(env, username);
  const desktop = isDesktopUA(request.headers.get('user-agent'));
  const { props, cacheControl } = buildUserProps(result, copy, locale, forumBase, desktop, username);
  return renderShareLanding(props, request.url, cacheControl ? { cacheControl } : {});
}

function buildEventProps(
  result: EventLookupResult,
  copy: Copy,
  locale: Lang,
  forumBase: string,
  desktop: boolean,
  eventId: string,
): { props: ShareLandingProps; cacheControl?: string } {
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase'> = {
    kind: 'e',
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
  };

  // Desktop has no app: keep the "Open in browser" label (like profile's
  // forumProfileCTA) and point at the event's forum topic post — or the forum
  // home when the post URL is absent. Only a missing forumBase falls back to the
  // app-install CTA.
  const forumEventCTA = (postUrl: string | null) =>
    forumBase
      ? { label: copy.webCtaLabel, url: postUrl ? `${forumBase}${postUrl}` : forumBase }
      : base.primaryCTA;

  switch (result.status) {
    case 'valid': {
      if (desktop) {
        return { props: { ...base, primaryCTA: forumEventCTA(result.event.post_url), event: result.event } };
      }
      // Mobile: App Store primary + an "open in the app" deep link that funnels
      // users who already have the app straight to the in-app event.
      const appCTA = { label: copy.openInAppLabel, url: `dirtbikex://s/e/${eventId}` };
      return { props: { ...base, appCTA, event: result.event } };
    }
    case 'not_found': {
      const nf = getEventNotFound(locale);
      return {
        props: { ...base, title: nf.title, subtitle: nf.subtitle },
        cacheControl: 'no-cache',
      };
    }
    case 'unreachable':
      return { props: { ...base, title: copy.fallbackTitle }, cacheControl: 'no-cache' };
  }
}

async function handleEvent(request: Request, env: Env, eventId: string): Promise<Response> {
  const url = new URL(request.url);
  const locale = pickLocale(url, request.headers.get('accept-language'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';

  const result = await lookupEvent(env, eventId);
  const desktop = isDesktopUA(request.headers.get('user-agent'));
  const { props, cacheControl } = buildEventProps(result, copy, locale, forumBase, desktop, eventId);
  return renderShareLanding(props, request.url, cacheControl ? { cacheControl } : {});
}

const FORUM_API_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

async function handleForumMetrics(env: Env): Promise<Response> {
  const result = await fetchForumMetrics(env);
  if (result.status !== 'ok') {
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
  return new Response(JSON.stringify(result.payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': FORUM_API_CACHE_CONTROL },
  });
}

async function handleForumFeatured(env: Env): Promise<Response> {
  const result = await fetchForumFeatured(env);
  if (result.status !== 'ok') {
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
  return new Response(JSON.stringify(result.payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': FORUM_API_CACHE_CONTROL },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/s\/i\/([^/]+)\/?$/);
    if (m && request.method === 'GET') {
      return handleInvite(request, env, m[1]);
    }
    const su = url.pathname.match(/^\/s\/u\/([^/]+)\/?$/);
    if (su && request.method === 'GET') {
      return handleUser(request, env, decodeURIComponent(su[1]));
    }
    const se = url.pathname.match(/^\/s\/e\/([^/]+)\/?$/);
    if (se && request.method === 'GET') {
      return handleEvent(request, env, decodeURIComponent(se[1]));
    }
    if (request.method === 'GET') {
      if (url.pathname === '/api/forum/metrics.json') return handleForumMetrics(env);
      if (url.pathname === '/api/forum/featured.json') return handleForumFeatured(env);
      if (url.pathname === '/api/proxy/sponsors') return fetchSponsors(env);
      const lb = url.pathname.match(/^\/api\/proxy\/leaderboard\/([a-z_]+)\.json$/);
      if (lb) return fetchLeaderboard(env, lb[1]!);
      // Douyin/Bilibili short-link resolver for the forum embed component.
      if (url.pathname === '/api/resolve/shortlink') return handleShortlinkResolve(request, env);
    }

    // /api/logto/sms — Logto HTTP SMS connector. See docs/sms-gateway.md.
    if (url.pathname === '/api/logto/sms' && request.method === 'POST') {
      return handleLogtoSms(request, env);
    }

    // /api/outreach/* — pre-invite outreach (single test send + batch pipeline).
    // See worker/_lib/outreach.ts + docs/OUTREACH_MODULE.md.
    if (url.pathname === '/api/outreach/test' && request.method === 'POST') {
      return handleOutreachTest(request, env);
    }
    if (url.pathname === '/api/outreach/batch' && request.method === 'POST') {
      return handleBatch(request, env);
    }
    if (url.pathname === '/api/outreach/preview' && request.method === 'GET') {
      return handlePreview(request, env);
    }
    if (url.pathname === '/api/outreach/status' && request.method === 'GET') {
      return handleStatus(request, env);
    }
    if (url.pathname === '/api/outreach/metrics' && request.method === 'GET') {
      return handleMetrics(request, env);
    }
    if (url.pathname === '/api/outreach/drip' && request.method === 'POST') {
      return handleDrip(request, env);
    }
    if (url.pathname === '/api/outreach/u' && (request.method === 'GET' || request.method === 'POST')) {
      return handleUnsub(request, env);
    }
    if (url.pathname === '/api/outreach/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    // /join double-opt-in waitlist. See worker/_lib/join.ts.
    if (url.pathname === '/api/join' && request.method === 'POST') {
      return handleJoinSubmit(request, env);
    }
    if (url.pathname === '/api/join/code' && request.method === 'GET') {
      return handleCodePrecheck(request, env);
    }
    if (url.pathname === '/join/confirm' && request.method === 'GET') {
      return handleJoinConfirm(request, env);
    }
    if (url.pathname === '/api/unsubscribe' && (request.method === 'GET' || request.method === 'POST')) {
      return handleUnsubscribe(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  // Cron trigger (wrangler.jsonc `triggers.crons`) → one outreach drip tick.
  // On prod this drains `real` sends under the warm-up budget; on preview it drains
  // test rows (override → your inbox, dry_run → log). Real mode is gated at enqueue.
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(runDrip(env, { dry: false }));
  },
};
