import { lookupInvite, type LookupResult } from './_lib/inviteLookup';
import { lookupUser, type UserLookupResult } from './_lib/userLookup';
import { lookupEvent, type EventLookupResult } from './_lib/eventLookup';
import { entityNotFound, renderShareLanding } from './_lib/render';
import { fetchForumMetrics } from './_lib/forumMetrics';
import { fetchForumFeatured } from './_lib/forumFeatured';
import { fetchSponsors, fetchLeaderboard } from './_lib/sponsorProxy';
import { handleLogtoSms } from './_lib/logtoSms';
import { handleOutreachTest, handleBatch, handlePreview, handleStatus, handleMetrics, handleUnsub, handleDrip, handleWebhook, runDrip } from './_lib/outreach';
import { handleJoinSubmit, handleJoinConfirm, handleUnsubscribe, handleCodePrecheck } from './_lib/join';
import { handleShortlinkResolve } from './_lib/shortlink';
import { handleMapDoc } from './_lib/mapData';
import {
  handleTrailUpload,
  handleTrailResolve,
  handleTrailGpx,
  handleTrailDelete,
  handleUploadStatus,
  handleTrailsAdmin,
  trailForShare,
  claimPreview,
  publicTrailEntries,
  sweepExpiredTrails,
  reconcileTrails,
  signPendingTrails,
  handleTrailImport,
  handleClaimPeek,
  handleClaimResolve,
  handleClaimBind,
  handleTrailState,
} from './_lib/trailUpload';
import { handleOgPreview } from './_lib/ogPreview';
import { ENTITY_KINDS, SHARE_ALIASES, loadEntity } from './_lib/shareEntity';
import { lookupResume, lookupClaimPreview, lookupTrackContributors, lookupRiderPins, lineagePath } from './_lib/lineageLookup';
import { renderResume, renderClaim, renderLineageNotFound, getFacetLabels, hasCopy, hasFacetLabels } from './_lib/lineageRender';
import { debugPanel, type DebugPayload, type LineageTrace } from './_lib/lineageDebug';
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

/**
 * The escape-hatch line. One sentence, all 21 locales, falls back to `en`.
 *
 * These are the host app's OWN menu words, not a translation of an instruction — the rider
 * is matching text on a screen. WeChat labels that item in WeChat's UI language, which
 * usually tracks the phone, which is also what picks the locale here.
 */
const BROWSER_HINT: Partial<Record<Lang, string>> = {
  en: 'Tap ··· · Open in Default Browser',
  'zh-CN': '点击 ··· 用默认浏览器打开',
  'zh-TW': '點擊 ··· 用預設瀏覽器開啟',
  ja: '··· をタップ →「デフォルトブラウザで開く」',
  ko: '··· 탭 → 기본 브라우저로 열기',
  de: '··· tippen · Im Standardbrowser öffnen',
  it: 'Tocca ··· · Apri nel browser predefinito',
  fr: 'Touchez ··· · Ouvrir dans le navigateur par défaut',
  es: 'Toca ··· · Abrir en el navegador predeterminado',
  ar: 'اضغط ··· · افتح في المتصفح الافتراضي',
  da: 'Tryk ··· · Åbn i standardbrowser',
  el: 'Πατήστε ··· · Άνοιγμα στο προεπιλεγμένο πρόγραμμα περιήγησης',
  'fa-IR': '··· را بزنید · باز کردن در مرورگر پیش‌فرض',
  fi: 'Napauta ··· · Avaa oletusselaimessa',
  id: 'Ketuk ··· · Buka di browser bawaan',
  nl: 'Tik op ··· · Openen in standaardbrowser',
  pt: 'Toque em ··· · Abrir no navegador padrão',
  'tr-TR': '··· öğesine dokunun · Varsayılan tarayıcıda aç',
  th: 'แตะ ··· · เปิดในเบราว์เซอร์เริ่มต้น',
  vi: 'Chạm ··· · Mở bằng trình duyệt mặc định',
  sv: 'Tryck ··· · Öppna i standardwebbläsaren',
};

/**
 * The hint, or `undefined` when the container is not one that blocks the hand-off.
 *
 * Only WeChat is claimed. WeCom carries `MicroMessenger` too and has the same menu item, so
 * it rides along. A Mini Program web view is excluded deliberately: it may have no browser
 * item at all, and an arrow pointing at something absent is worse than silence. Douyin is
 * NOT included — its chrome is unmeasured (see `ios/agents.d/modules/e2e-findings-plan.md` § 2).
 */
function browserHintFor(ua: string | null, locale: Lang): ShareLandingProps['browserHint'] {
  if (!ua || !/MicroMessenger/i.test(ua) || /miniProgram/i.test(ua)) return undefined;
  return { line: BROWSER_HINT[locale] ?? BROWSER_HINT.en! };
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
function pickLocale(url: URL, acceptLanguage: string | null, userAgent?: string | null): Lang {
  // `?lang=auto` is the iOS share-link default (ShareLookup.shareURL) — it
  // explicitly defers to Accept-Language negotiation below. Any other value
  // pins the card; matched leniently via `matchTag` so `?lang=zh-cn`, `zh`,
  // or `ZH_CN` all resolve like `zh-CN` (case/format no longer has to be exact).
  const qs = url.searchParams.get('lang');
  if (qs && qs !== 'auto') {
    const pinned = matchTag(qs);
    if (pinned) return pinned;
  }

  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((t) => t.trim().split(';')[0]!.trim())
    .filter(Boolean);
  for (const raw of tags) {
    const m = matchTag(raw);
    if (m) return m;
  }

  // WeChat renders a link card from ONE crawler fetch and caches it against the
  // URL, so the reader's own language never reaches this decision — the crawler's
  // does, and it sends none. Without this every card pasted into WeChat comes out
  // English for a Chinese audience. `?lang=` still wins, so a link we generate can
  // still pin any locale it likes.
  if (userAgent && /MicroMessenger/i.test(userAgent)) return 'zh-CN';
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
 * so the valid-invite CTA points at the forum's web accept page instead.
 *
 * Per-UA branching is safe because these responses carry their own `no-cache` /
 * `no-store` — NOT because of `public/_headers`. That file does not apply to
 * worker-rendered responses (`/s/*` is in `run_worker_first`) and its rules append
 * rather than override. If a branch here ever stops setting its own header, an edge
 * cache can serve one device's variant to the other.
 */
function isDesktopUA(ua: string | null): boolean {
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(ua ?? '');
}

/**
 * iOS/iPadOS, for the claim card's "finish this in the app" ask.
 *
 * Same `no-store` reasoning as above — per-UA branching is safe here because the edge
 * never keeps a copy. Desktop Safari on a Mac is deliberately NOT matched even though
 * iPadOS reports a Macintosh UA: over-matching shows a Mac user an App Store prompt for
 * an app they cannot install, and the cost of missing a desktop-mode iPad is one extra
 * tap on a page that still works.
 */
function isIOSUA(ua: string | null): boolean {
  return /iPhone|iPad|iPod/i.test(ua ?? '');
}

function buildProps(
  result: LookupResult,
  copy: Copy,
  locale: Lang,
  forumBase: string,
  desktop: boolean,
  hint: ShareLandingProps['browserHint'],
): { props: ShareLandingProps; cacheControl?: string } {
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase' | 'browserHint'> = {
    kind: 'i',
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
    browserHint: hint,
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
  const locale = pickLocale(url, request.headers.get('accept-language'), request.headers.get('user-agent'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';

  const result = await lookupInvite(env, key);
  const desktop = isDesktopUA(request.headers.get('user-agent'));
  const hint = browserHintFor(request.headers.get('user-agent'), locale);
  const { props, cacheControl } = buildProps(result, copy, locale, forumBase, desktop, hint);
  return renderShareLanding(props, request.url, cacheControl ? { cacheControl } : {});
}

function buildUserProps(
  result: UserLookupResult,
  copy: Copy,
  locale: Lang,
  forumBase: string,
  desktop: boolean,
  hint: ShareLandingProps['browserHint'],
  username: string,
): { props: ShareLandingProps; cacheControl?: string } {
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase' | 'browserHint'> = {
    kind: 'u',
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
    browserHint: hint,
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
  const locale = pickLocale(url, request.headers.get('accept-language'), request.headers.get('user-agent'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';

  const result = await lookupUser(env, username);
  const desktop = isDesktopUA(request.headers.get('user-agent'));
  const hint = browserHintFor(request.headers.get('user-agent'), locale);
  const { props, cacheControl } = buildUserProps(result, copy, locale, forumBase, desktop, hint, username);
  return renderShareLanding(props, request.url, cacheControl ? { cacheControl } : {});
}

function buildEventProps(
  result: EventLookupResult,
  copy: Copy,
  locale: Lang,
  forumBase: string,
  desktop: boolean,
  hint: ShareLandingProps['browserHint'],
  eventId: string,
): { props: ShareLandingProps; cacheControl?: string } {
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase' | 'browserHint'> = {
    kind: 'e',
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
    browserHint: hint,
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
  const locale = pickLocale(url, request.headers.get('accept-language'), request.headers.get('user-agent'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';

  const result = await lookupEvent(env, eventId);
  const desktop = isDesktopUA(request.headers.get('user-agent'));
  const hint = browserHintFor(request.headers.get('user-agent'), locale);
  const { props, cacheControl } = buildEventProps(result, copy, locale, forumBase, desktop, hint, eventId);
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

/**
 * `/s/<kind>/<key>` for the things on the map. `?from=<username>` names the sender,
 * so the card can open with "Monkeyboi wants to share a route with you" — the sharer
 * is not always the author, and for a track or a shop there is no author at all.
 */
async function handleEntity(request: Request, env: Env, kindCode: string, key: string): Promise<Response> {
  const url = new URL(request.url);
  const locale = pickLocale(url, request.headers.get('accept-language'), request.headers.get('user-agent'));
  const copy = getCopy(locale);
  const forumBase = env.FORUM_BASE ?? '';
  const kind = ENTITY_KINDS[kindCode]!;

  let entity = await loadEntity(request, env, kind, key, locale);
  // A link-only trail is not in the map document. Fall back to D1 so its card unfurls
  // instead of rendering "not found" for the one kind of trail whose only address is the
  // link somebody just pasted. Marked so the response can be kept out of every cache.
  let fromD1 = false;
  if (!entity && kind === 'route') {
    const row = await trailForShare(env, key);
    if (row) {
      entity = await loadEntity(request, env, kind, key, locale, row);
      fromD1 = !!entity;
    }
  }
  const base: Pick<ShareLandingProps, 'kind' | 'locale' | 'primaryCTA' | 'returnTapCopy' | 'forumBase' | 'browserHint'> = {
    browserHint: browserHintFor(request.headers.get('user-agent'), locale),
    kind: kindCode as ShareLandingProps['kind'],
    locale,
    primaryCTA: { label: copy.ctaLabel, url: APP_STORE_URL },
    returnTapCopy: copy.returnTap,
    forumBase,
  };

  if (!entity) {
    const nf = entityNotFound(locale);
    return renderShareLanding(
      { ...base, title: nf.title, subtitle: nf.body },
      request.url,
      { status: 404, cacheControl: 'no-store' },
    );
  }

  // Only resolved when asked for: an unattributed share stays one request.
  const from = url.searchParams.get('from');
  const sender = from ? await lookupSender(env, from) : null;

  // No app CTA: AASA does not claim these paths, and the app has no destination
  // for most of them. When it gains one, the path joins AASA and the OS opens the
  // app *instead of* this page — the merge, without a second button.
  //
  // `?stay=1` disarms the countdown. It is how you inspect a card, and how the
  // asset test keeps these routes under the no-third-party-hosts rule instead of
  // following them into the map's tile host.
  const autoJump = url.searchParams.get('stay') !== '1';
  return renderShareLanding(
    { ...base, entity, sharedBy: sender, autoJump },
    request.url,
    // A card built from D1 is a link-only trail's card, and the id in its URL is the
    // secret. /share/* has no _headers rule, so it would otherwise fall to /*'s
    // s-maxage=86400 and sit in a PoP for a day.
    fromD1 ? { cacheControl: 'no-store' } : {},
  );
}

/** The sharer's name and face, from the same anonymous profile read `/s/u` uses. */
async function lookupSender(env: Env, username: string): Promise<{ name: string; avatarURL: string | null } | null> {
  const result = await lookupUser(env, username).catch(() => null);
  if (!result || result.status !== 'valid' || result.user.hidden) return null;
  const user = result.user;
  const path = user.avatar_template ? user.avatar_template.replace('{size}', '96') : null;
  return {
    name: user.name?.trim() || user.username,
    avatarURL: path ? (path.startsWith('http') ? path : `${env.FORUM_BASE ?? ''}${path}`) : null,
  };
}

/** Locale + canonical URL, shared by both lineage pages. */
function lineageContext(request: Request, env: Env) {
  const url = new URL(request.url);
  const locale = pickLocale(url, request.headers.get('accept-language'), request.headers.get('user-agent'));
  return {
    locale,
    url: url.origin + url.pathname,
    forumBase: env.FORUM_BASE ?? '',
    facetLabels: getFacetLabels(locale),
    debug: url.searchParams.get('debug') === 'true',
  };
}

/**
 * `/s/lineage/<username>` is the share spelling of the résumé: a bare segment is
 * a forum username, because that is the only handle a person can be told over
 * the phone. `r-…` and a leading `@` still address the node directly, so a link
 * built from either half of the graph resolves.
 */
function shareLineageRef(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('@')) return v;
  return /^r-[a-z0-9]+$/i.test(v) ? v : `@${v}`;
}

function lineageTrace(
  request: Request,
  ctx: ReturnType<typeof lineageContext>,
  fields: { route: string; param: string; ref: string; upstreamPath: string; ms: number; result: { status: string; httpStatus?: number | null; reason?: string } },
  canonical: string
): LineageTrace {
  const url = new URL(request.url);
  return {
    route: fields.route,
    param: fields.param,
    ref: fields.ref,
    upstreamURL: `${ctx.forumBase}${fields.upstreamPath}`,
    outcome: fields.result.status === 'unreachable' ? `unreachable:${fields.result.reason}` : fields.result.status,
    httpStatus: fields.result.httpStatus ?? null,
    ms: fields.ms,
    langParam: url.searchParams.get('lang'),
    acceptLanguage: request.headers.get('accept-language'),
    locale: ctx.locale,
    hasCopy: hasCopy(ctx.locale),
    hasLabels: hasFacetLabels(ctx.locale),
    canonical,
    forumBase: ctx.forumBase,
  };
}

async function handleLineagePage(request: Request, env: Env, ref: string, route: string, param: string): Promise<Response> {
  const ctx = lineageContext(request, env);
  const started = Date.now();
  const result = await lookupResume(env, ref);
  const ms = Date.now() - started;
  // Both routes render the same document; `/lineage/<ref>` is the indexed one.
  const canonical = `${new URL(request.url).origin}/lineage/${encodeURI(ref)}`;

  const panel = (payload: DebugPayload) =>
    ctx.debug
      ? debugPanel(
          lineageTrace(request, ctx, { route, param, ref, upstreamPath: lineagePath(ref), ms, result }, canonical),
          payload,
          ctx.facetLabels
        )
      : null;

  if (result.status !== 'valid') {
    return renderLineageNotFound(ctx.locale, ctx.url, panel({ kind: 'none' }));
  }
  return renderResume(result.data, {
    ...ctx,
    appStoreURL: APP_STORE_URL,
    canonical,
    debug: panel({ kind: 'resume', data: result.data }),
  });
}

/**
 * The one-time claim card a visitor is handed after an upload. See agents.d/modules/trail-upload.md.
 *
 * It is deliberately a buffer rather than a redirect: the code is a bearer credential and
 * the jump lands on a forum login, so a visitor who arrives here needs to be told what is
 * about to happen and to whom the trail will belong. It is also where the code stops being
 * only in a clipboard — the forum route carries it in the query string, which is what
 * survives the login round-trip.
 *
 * IT LOOKS NOTHING UP, and that is the entire reason a six-digit code is safe.
 *
 * It used to render three different answers — open, already claimed, no such code — which
 * made it an oracle: an attacker could sweep the keyspace with cheap anonymous GETs and
 * read off which codes exist, and at 10^6 that is an afternoon. Now every code renders the
 * same card, so the only thing that can tell you whether a code is real is the forum's
 * claim route, which is behind a login and a rate limiter. Do not reintroduce a lookup
 * here, and do not add an endpoint anywhere that answers yes-or-no to a claim code.
 *
 * `/s/c/*` IS in the AASA as of landing v1.0.32, because iOS v1.0.3 shipped
 * `ShareKind.trailClaim` and the app finally has a destination for it. (This comment
 * previously said the opposite; it was written while the claim was excluded.)
 *
 * The rule it encodes still stands and is the reason to keep reading: a path joins the
 * AASA only when the SHIPPED app has a destination for it. Claiming one early is what
 * makes the app raise its invalid-link bubble on a perfectly good link — worse than not
 * claiming it, since an unclaimed link just opens on the web and works.
 */
interface ClaimCopy {
  title: string;
  /** Second visit: the code is spent, so the page stops asking and starts pointing. */
  claimedBody: string;
  claimedCta: string;
  body: string;
  cta: string;
  slowTitle: string;
  slowBody: string;
  loop: string;
  pointToPoint: string;
  distance: string;
  climb: string;
  signed: string;
  /** Shown only on iOS, before the CTA hands off to the forum. */
  appPrompt: string;
  /** Marks the app option as the better one, without an argument for it. */
  recommended: string;
  expires: string;
  backToMap: string;
}

const CLAIM_COPY: Partial<Record<Lang, ClaimCopy>> = {
  en: {
    title: 'This link is your secret',
    claimedBody: 'This one is already yours. Your message on the forum holds the file and the switch that puts it on the public map.',
    claimedCta: 'Open my message',
    body: 'One more step: set up a quick profile so we know who rode it. Your trail can stay private — we only want to put your name on it.',
    cta: 'Set up my profile',
    slowTitle: 'Too many attempts',
    slowBody: 'Wait a few minutes, then open your link again. Nothing is lost.',
    loop: 'Loop',
    pointToPoint: 'Point to point',
    distance: 'Distance',
    climb: 'Climb',
    signed: 'Ready to sign',
    appPrompt: 'DirtBikeX works best in the app.',
    recommended: 'Recommended',
    expires: 'expires in {n} h',
    backToMap: 'See it on the map',
  },
  'zh-CN': {
    title: '这是你的专属链接',
    claimedBody: '这条轨迹已经是你的了。论坛上的私信里存着文件，也有把它放上公开地图的开关。',
    claimedCta: '打开我的私信',
    body: '只差一步：简单建个资料，让我们知道这是谁骑的。轨迹可以继续保持私密——我们只是想给它署上你的名字。',
    cta: '建立我的资料',
    slowTitle: '尝试次数过多',
    slowBody: '请稍等几分钟再打开你的链接。什么都没丢。',
    loop: '环线',
    pointToPoint: '点到点',
    distance: '距离',
    climb: '爬升',
    signed: '等你签名',
    appPrompt: 'DirtBikeX 在 App 里体验更好。',
    recommended: '推荐',
    expires: '{n} 小时后过期',
    backToMap: '在地图上查看',
  },
  'zh-TW': {
    title: '這是你的專屬連結',
    claimedBody: '這條路線已經是你的了。論壇上的私訊裡存著檔案，也有把它放上公開地圖的開關。',
    claimedCta: '開啟我的私訊',
    body: '只差一步：簡單建個檔案，讓我們知道這是誰騎的。軌跡可以繼續保持私密——我們只是想給它署上你的名字。',
    cta: '建立我的檔案',
    slowTitle: '嘗試次數過多',
    slowBody: '請稍等幾分鐘再打開你的連結。什麼都沒丟。',
    loop: '環線',
    pointToPoint: '點到點',
    distance: '距離',
    climb: '爬升',
    signed: '等你簽名',
    appPrompt: 'DirtBikeX 在 App 裡體驗更好。',
    recommended: '推薦',
    expires: '{n} 小時後過期',
    backToMap: '在地圖上查看',
  },
  ja: {
    title: 'これはあなただけのリンクです',
    claimedBody: 'このルートはすでにあなたのものです。フォーラムのメッセージにファイルと、公開マップに載せるスイッチがあります。',
    claimedCta: 'メッセージを開く',
    body: 'あと一歩。かんたんなプロフィールを作って、誰が走ったのか教えてください。ルートは非公開のままで大丈夫です — 名前をつけたいだけです。',
    cta: 'プロフィールを作る',
    slowTitle: '試行が多すぎます',
    slowBody: '数分待ってから、もう一度リンクを開いてください。何も失われていません。',
    loop: 'ループ',
    pointToPoint: '片道',
    distance: '距離',
    climb: '獲得標高',
    signed: '署名を待っています',
    appPrompt: 'DirtBikeX はアプリでより快適に使えます。',
    recommended: 'おすすめ',
    expires: '残り {n} 時間',
    backToMap: '地図で見る',
  },
  ko: {
    title: '이 링크는 당신만의 것입니다',
    claimedBody: '이 경로는 이미 회원님의 것입니다. 포럼 메시지에 파일과 공개 지도에 올리는 스위치가 있습니다.',
    claimedCta: '내 메시지 열기',
    body: '한 걸음만 더. 간단한 프로필을 만들어 누가 탔는지 알려주세요. 트레일은 계속 비공개여도 됩니다 — 이름만 붙이려는 것입니다.',
    cta: '프로필 만들기',
    slowTitle: '시도가 너무 많습니다',
    slowBody: '몇 분 뒤에 링크를 다시 열어 주세요. 잃은 것은 없습니다.',
    loop: '루프',
    pointToPoint: '편도',
    distance: '거리',
    climb: '상승',
    signed: '서명을 기다리는 중',
    appPrompt: 'DirtBikeX는 앱에서 가장 잘 작동합니다.',
    recommended: '추천',
    expires: '{n}시간 남음',
    backToMap: '지도에서 보기',
  },
  de: {
    title: 'Dieser Link ist dein Geheimnis',
    claimedBody: 'Diese Route gehört bereits dir. In deiner Nachricht im Forum liegen die Datei und der Schalter für die öffentliche Karte.',
    claimedCta: 'Meine Nachricht öffnen',
    body: 'Nur noch ein Schritt: leg ein kurzes Profil an, damit wir wissen, wer gefahren ist. Die Strecke darf privat bleiben — wir wollen nur deinen Namen darauf.',
    cta: 'Profil anlegen',
    slowTitle: 'Zu viele Versuche',
    slowBody: 'Warte ein paar Minuten und öffne den Link erneut. Nichts ist verloren.',
    loop: 'Runde',
    pointToPoint: 'Punkt zu Punkt',
    distance: 'Distanz',
    climb: 'Anstieg',
    signed: 'Bereit zum Signieren',
    appPrompt: 'DirtBikeX funktioniert in der App am besten.',
    recommended: 'Empfohlen',
    expires: 'läuft in {n} h ab',
    backToMap: 'Auf der Karte ansehen',
  },
  fr: {
    title: 'Ce lien est votre secret',
    claimedBody: 'Cette trace est déjà la vôtre. Votre message sur le forum contient le fichier et le bouton qui la met sur la carte publique.',
    claimedCta: 'Ouvrir mon message',
    body: 'Encore une étape : créez un profil rapide pour qu’on sache qui a roulé. La trace peut rester privée — on veut seulement y mettre votre nom.',
    cta: 'Créer mon profil',
    slowTitle: 'Trop de tentatives',
    slowBody: 'Attendez quelques minutes puis rouvrez votre lien. Rien n’est perdu.',
    loop: 'Boucle',
    pointToPoint: 'Point à point',
    distance: 'Distance',
    climb: 'Dénivelé',
    signed: 'Prêt à signer',
    appPrompt: 'DirtBikeX fonctionne mieux dans l’application.',
    recommended: 'Recommandé',
    expires: 'expire dans {n} h',
    backToMap: 'Voir sur la carte',
  },
  es: {
    title: 'Este enlace es tu secreto',
    claimedBody: 'Esta ruta ya es tuya. Tu mensaje en el foro guarda el archivo y el interruptor que la pone en el mapa público.',
    claimedCta: 'Abrir mi mensaje',
    body: 'Un paso más: crea un perfil rápido para saber quién la rodó. La ruta puede seguir siendo privada: solo queremos ponerle tu nombre.',
    cta: 'Crear mi perfil',
    slowTitle: 'Demasiados intentos',
    slowBody: 'Espera unos minutos y vuelve a abrir tu enlace. No se ha perdido nada.',
    loop: 'Circular',
    pointToPoint: 'Punto a punto',
    distance: 'Distancia',
    climb: 'Desnivel',
    signed: 'Listo para firmar',
    appPrompt: 'DirtBikeX funciona mejor en la app.',
    recommended: 'Recomendado',
    expires: 'caduca en {n} h',
    backToMap: 'Verla en el mapa',
  },
  pt: {
    title: 'Este link é o seu segredo',
    claimedBody: 'Este trajeto já é seu. A sua mensagem no fórum guarda o ficheiro e o botão que o coloca no mapa público.',
    claimedCta: 'Abrir a minha mensagem',
    body: 'Falta um passo: crie um perfil rápido para sabermos quem andou. A trilha pode continuar privada — só queremos pôr o seu nome nela.',
    cta: 'Criar o meu perfil',
    slowTitle: 'Demasiadas tentativas',
    slowBody: 'Espere uns minutos e abra o link de novo. Nada se perdeu.',
    loop: 'Circuito',
    pointToPoint: 'Ponto a ponto',
    distance: 'Distância',
    climb: 'Ganho',
    signed: 'Pronto para assinar',
    appPrompt: 'O DirtBikeX funciona melhor no app.',
    recommended: 'Recomendado',
    expires: 'expira em {n} h',
    backToMap: 'Ver no mapa',
  },
  it: {
    title: 'Questo link è il tuo segreto',
    claimedBody: 'Questo percorso è già tuo. Il messaggio sul forum contiene il file e l\'interruttore che lo mette sulla mappa pubblica.',
    claimedCta: 'Apri il mio messaggio',
    body: 'Manca un passo: crea un profilo veloce così sappiamo chi ha guidato. Il percorso può restare privato — vogliamo solo metterci il tuo nome.',
    cta: 'Crea il mio profilo',
    slowTitle: 'Troppi tentativi',
    slowBody: 'Aspetta qualche minuto e riapri il link. Non si è perso nulla.',
    loop: 'Anello',
    pointToPoint: 'Punto a punto',
    distance: 'Distanza',
    climb: 'Dislivello',
    signed: 'Pronto da firmare',
    appPrompt: 'DirtBikeX funziona meglio nell’app.',
    recommended: 'Consigliato',
    expires: 'scade tra {n} h',
    backToMap: 'Vedilo sulla mappa',
  },
  nl: {
    title: 'Deze link is van jou alleen',
    claimedBody: 'Deze route is al van jou. In je bericht op het forum staan het bestand en de schakelaar voor de openbare kaart.',
    claimedCta: 'Mijn bericht openen',
    body: 'Nog één stap: maak snel een profiel zodat we weten wie er reed. De route mag privé blijven — we willen er alleen je naam bij.',
    cta: 'Mijn profiel maken',
    slowTitle: 'Te veel pogingen',
    slowBody: 'Wacht een paar minuten en open je link opnieuw. Er is niets kwijt.',
    loop: 'Rondje',
    pointToPoint: 'Van A naar B',
    distance: 'Afstand',
    climb: 'Stijging',
    signed: 'Klaar om te ondertekenen',
    appPrompt: 'DirtBikeX werkt het best in de app.',
    recommended: 'Aanbevolen',
    expires: 'verloopt over {n} u',
    backToMap: 'Bekijk op de kaart',
  },
  da: {
    title: 'Dette link er din hemmelighed',
    claimedBody: 'Denne rute er allerede din. Din besked på forummet indeholder filen og kontakten, der sætter den på det offentlige kort.',
    claimedCta: 'Åbn min besked',
    body: 'Ét skridt mere: lav en hurtig profil, så vi ved, hvem der kørte. Sporet må gerne forblive privat — vi vil bare sætte dit navn på.',
    cta: 'Opret min profil',
    slowTitle: 'For mange forsøg',
    slowBody: 'Vent et par minutter, og åbn dit link igen. Intet er gået tabt.',
    loop: 'Rundtur',
    pointToPoint: 'Punkt til punkt',
    distance: 'Distance',
    climb: 'Stigning',
    signed: 'Klar til at signere',
    appPrompt: 'DirtBikeX fungerer bedst i appen.',
    recommended: 'Anbefalet',
    expires: 'udløber om {n} t',
    backToMap: 'Se det på kortet',
  },
  sv: {
    title: 'Den här länken är din hemlighet',
    claimedBody: 'Den här rutten är redan din. Ditt meddelande på forumet har filen och reglaget som lägger den på den publika kartan.',
    claimedCta: 'Öppna mitt meddelande',
    body: 'Ett steg till: skapa en snabb profil så vi vet vem som körde. Spåret får gärna förbli privat — vi vill bara sätta ditt namn på det.',
    cta: 'Skapa min profil',
    slowTitle: 'För många försök',
    slowBody: 'Vänta några minuter och öppna länken igen. Inget är förlorat.',
    loop: 'Runda',
    pointToPoint: 'Punkt till punkt',
    distance: 'Distans',
    climb: 'Stigning',
    signed: 'Redo att signeras',
    appPrompt: 'DirtBikeX fungerar bäst i appen.',
    recommended: 'Rekommenderas',
    expires: 'går ut om {n} h',
    backToMap: 'Se det på kartan',
  },
  fi: {
    title: 'Tämä linkki on sinun salaisuutesi',
    claimedBody: 'Tämä reitti on jo sinun. Foorumin viestissäsi on tiedosto ja kytkin, joka vie sen julkiselle kartalle.',
    claimedCta: 'Avaa viestini',
    body: 'Enää askel: tee nopea profiili, jotta tiedämme kuka ajoi. Reitti saa pysyä yksityisenä — haluamme vain nimesi siihen.',
    cta: 'Luo profiilini',
    slowTitle: 'Liikaa yrityksiä',
    slowBody: 'Odota muutama minuutti ja avaa linkki uudelleen. Mitään ei ole menetetty.',
    loop: 'Lenkki',
    pointToPoint: 'Pisteestä pisteeseen',
    distance: 'Matka',
    climb: 'Nousu',
    signed: 'Valmis allekirjoitettavaksi',
    appPrompt: 'DirtBikeX toimii parhaiten sovelluksessa.',
    recommended: 'Suositeltu',
    expires: 'vanhenee {n} h kuluttua',
    backToMap: 'Katso kartalla',
  },
  el: {
    title: 'Αυτός ο σύνδεσμος είναι δικός σου',
    claimedBody: 'Αυτή η διαδρομή είναι ήδη δική σου. Το μήνυμά σου στο φόρουμ έχει το αρχείο και τον διακόπτη για τον δημόσιο χάρτη.',
    claimedCta: 'Άνοιγμα του μηνύματός μου',
    body: 'Ένα βήμα ακόμα: φτιάξε ένα σύντομο προφίλ για να ξέρουμε ποιος οδήγησε. Η διαδρομή μπορεί να μείνει ιδιωτική — θέλουμε μόνο να βάλουμε το όνομά σου.',
    cta: 'Φτιάξε το προφίλ μου',
    slowTitle: 'Πάρα πολλές προσπάθειες',
    slowBody: 'Περίμενε λίγα λεπτά και άνοιξε ξανά τον σύνδεσμο. Τίποτα δεν χάθηκε.',
    loop: 'Κύκλος',
    pointToPoint: 'Σημείο σε σημείο',
    distance: 'Απόσταση',
    climb: 'Ανάβαση',
    signed: 'Έτοιμο για υπογραφή',
    appPrompt: 'Το DirtBikeX λειτουργεί καλύτερα στην εφαρμογή.',
    recommended: 'Προτεινόμενο',
    expires: 'λήγει σε {n} ώ',
    backToMap: 'Δες τη στον χάρτη',
  },
  'tr-TR': {
    title: 'Bu bağlantı sana özel',
    claimedBody: 'Bu rota zaten senin. Forumdaki mesajında dosya ve onu herkese açık haritaya koyan anahtar var.',
    claimedCta: 'Mesajımı aç',
    body: 'Bir adım kaldı: kısa bir profil oluştur da kimin sürdüğünü bilelim. Rota gizli kalabilir — sadece adını yazmak istiyoruz.',
    cta: 'Profilimi oluştur',
    slowTitle: 'Çok fazla deneme',
    slowBody: 'Birkaç dakika bekleyip bağlantını yeniden aç. Hiçbir şey kaybolmadı.',
    loop: 'Tur',
    pointToPoint: 'Noktadan noktaya',
    distance: 'Mesafe',
    climb: 'Tırmanış',
    signed: 'İmzalanmaya hazır',
    appPrompt: 'DirtBikeX en iyi uygulamada çalışır.',
    recommended: 'Önerilen',
    expires: '{n} sa sonra dolar',
    backToMap: 'Haritada gör',
  },
  id: {
    title: 'Tautan ini rahasiamu',
    claimedBody: 'Rute ini sudah milikmu. Pesanmu di forum menyimpan berkasnya dan sakelar untuk menaruhnya di peta publik.',
    claimedCta: 'Buka pesan saya',
    body: 'Tinggal satu langkah: buat profil singkat agar kami tahu siapa yang berkendara. Jalurnya boleh tetap privat — kami hanya ingin mencantumkan namamu.',
    cta: 'Buat profil saya',
    slowTitle: 'Terlalu banyak percobaan',
    slowBody: 'Tunggu beberapa menit lalu buka tautanmu lagi. Tidak ada yang hilang.',
    loop: 'Loop',
    pointToPoint: 'Titik ke titik',
    distance: 'Jarak',
    climb: 'Tanjakan',
    signed: 'Siap ditandatangani',
    appPrompt: 'DirtBikeX bekerja paling baik di aplikasi.',
    recommended: 'Direkomendasikan',
    expires: 'kedaluwarsa dalam {n} j',
    backToMap: 'Lihat di peta',
  },
  vi: {
    title: 'Liên kết này là bí mật của bạn',
    claimedBody: 'Cung đường này đã là của bạn. Tin nhắn trên diễn đàn giữ tệp và nút đưa nó lên bản đồ công khai.',
    claimedCta: 'Mở tin nhắn của tôi',
    body: 'Chỉ một bước nữa: tạo hồ sơ nhanh để chúng tôi biết ai đã chạy. Cung đường vẫn có thể riêng tư — chúng tôi chỉ muốn ghi tên bạn lên đó.',
    cta: 'Tạo hồ sơ của tôi',
    slowTitle: 'Quá nhiều lần thử',
    slowBody: 'Đợi vài phút rồi mở lại liên kết. Không mất gì cả.',
    loop: 'Vòng',
    pointToPoint: 'Điểm tới điểm',
    distance: 'Quãng đường',
    climb: 'Độ cao tăng',
    signed: 'Sẵn sàng để ký',
    appPrompt: 'DirtBikeX hoạt động tốt nhất trên ứng dụng.',
    recommended: 'Được đề xuất',
    expires: 'hết hạn sau {n} giờ',
    backToMap: 'Xem trên bản đồ',
  },
  th: {
    title: 'ลิงก์นี้เป็นความลับของคุณ',
    claimedBody: 'เส้นทางนี้เป็นของคุณแล้ว ข้อความในฟอรัมเก็บไฟล์และสวิตช์ที่นำขึ้นแผนที่สาธารณะไว้',
    claimedCta: 'เปิดข้อความของฉัน',
    body: 'อีกขั้นเดียว: สร้างโปรไฟล์สั้น ๆ เพื่อให้เรารู้ว่าใครขี่ เส้นทางจะเป็นส่วนตัวต่อไปก็ได้ — เราแค่อยากใส่ชื่อคุณลงไป',
    cta: 'สร้างโปรไฟล์ของฉัน',
    slowTitle: 'พยายามมากเกินไป',
    slowBody: 'รอสักครู่แล้วเปิดลิงก์อีกครั้ง ไม่มีอะไรหายไป',
    loop: 'วนรอบ',
    pointToPoint: 'จุดถึงจุด',
    distance: 'ระยะทาง',
    climb: 'ไต่ระดับ',
    signed: 'พร้อมลงชื่อ',
    appPrompt: 'DirtBikeX ใช้งานได้ดีที่สุดในแอป',
    recommended: 'แนะนำ',
    expires: 'หมดอายุใน {n} ชม.',
    backToMap: 'ดูบนแผนที่',
  },
  ar: {
    title: 'هذا الرابط سرّك',
    claimedBody: 'هذا المسار لك بالفعل. رسالتك في المنتدى تحتوي على الملف وعلى المفتاح الذي يضعه على الخريطة العامة.',
    claimedCta: 'افتح رسالتي',
    body: 'خطوة واحدة: أنشئ ملفًا سريعًا لنعرف من قاد. يمكن أن يبقى المسار خاصًا — نريد فقط أن نضع اسمك عليه.',
    cta: 'إنشاء ملفي',
    slowTitle: 'محاولات كثيرة',
    slowBody: 'انتظر بضع دقائق ثم افتح الرابط مجددًا. لم يضع شيء.',
    loop: 'حلقة',
    pointToPoint: 'من نقطة إلى نقطة',
    distance: 'المسافة',
    climb: 'الصعود',
    signed: 'جاهز للتوقيع',
    appPrompt: 'يعمل DirtBikeX بشكل أفضل في التطبيق.',
    recommended: 'موصى به',
    expires: 'ينتهي خلال {n} ساعة',
    backToMap: 'شاهده على الخريطة',
  },
  'fa-IR': {
    title: 'این لینک راز توست',
    claimedBody: 'این مسیر همین حالا مال شماست. پیام شما در انجمن فایل و کلید قرار دادن آن روی نقشهٔ عمومی را دارد.',
    claimedCta: 'پیام من را باز کن',
    body: 'یک قدم مانده: نمایهٔ کوتاهی بساز تا بدانیم چه کسی رکاب زده. مسیر می‌تواند خصوصی بماند — فقط می‌خواهیم نامت روی آن باشد.',
    cta: 'ساختن نمایه',
    slowTitle: 'تلاش‌های زیاد',
    slowBody: 'چند دقیقه صبر کن و لینک را دوباره باز کن. چیزی از دست نرفته.',
    loop: 'حلقه',
    pointToPoint: 'نقطه به نقطه',
    distance: 'مسافت',
    climb: 'صعود',
    signed: 'آماده امضا',
    appPrompt: 'DirtBikeX در اپلیکیشن بهتر کار می‌کند.',
    recommended: 'پیشنهادی',
    expires: 'تا {n} ساعت دیگر منقضی می‌شود',
    backToMap: 'دیدن روی نقشه',
  },
};

async function handleTrailClaim(request: Request, env: Env, code: string): Promise<Response> {
  const url = new URL(request.url);
  const locale = pickLocale(url, request.headers.get('accept-language'), request.headers.get('user-agent'));
  const copy = CLAIM_COPY[locale] ?? CLAIM_COPY.en!;
  // The two button labels already exist, translated, on the invite card's table. Writing
  // a second "Open in the app" would be two strings that can drift.
  const appCopy = COPY[locale] ?? COPY.en!;
  // The forum sends a rate-limited rider back here rather than showing them Discourse's
  // "page not found", which is what its rate-limit handler produces for a plain browser
  // navigation and which reads as "your link is broken" — so they retry, and spend more
  // budget. This is still a lookup-free page: the flag is in the URL, not in the database.
  const slow = url.searchParams.get('e') === 'slow';

  // Which trail this is. The card was stateless while the code was six digits, because at
  // 10^6 an endpoint confirming a code exists is an afternoon's sweep. The code is 8 chars
  // of 31 symbols again — 8.5e11 — so naming the trail is affordable, and it matters: a
  // page that says only "claim your trail" cannot tell you WHICH, and this is the page
  // somebody lands on after a login round-trip.
  const trail = slow ? null : await claimPreview(env, code);
  // The numbers go to the card as a LIST, not as a joined sentence. They used to be
  // "39 km · Loop · expires in 68 h" glued onto the front of the body copy, because the
  // generic error layout this page fell through to had nowhere else to put them.
  const facts = trail
    ? [
        trail.distanceKm ? { value: `${trail.distanceKm} km`, label: copy.distance } : null,
        trail.ascentM ? { value: `+${trail.ascentM} m`, label: copy.climb } : null,
      ].filter(Boolean) as { value: string; label: string }[]
    : [];

  return renderShareLanding(
    {
      kind: 'c',
      locale,
      // The claim card's app hand-off lives inside CLAIM_ASK_JS's popover rather than a
      // `.cta-secondary` anchor, so APP_FALLBACK_JS binds only the overlay's dismiss here
      // and CLAIM_ASK_JS owns the timer. One timer per tap — see its comment.
      browserHint: browserHintFor(request.headers.get('user-agent'), locale),
      title: slow ? copy.slowTitle : trail?.title || copy.title,
      subtitle: slow ? copy.slowBody : trail?.claimed ? copy.claimedBody : copy.body,
      // The sheet-shaped card is for a real trail. A rate-limited visitor has no trail to
      // show, so that one keeps the plain layout — a tick over "too many attempts" would
      // be telling somebody their problem went well.
      trailClaim: trail
        ? {
            facts,
            shape:
              trail.shape === 'loop'
                ? copy.loop
                : trail.shape === 'point_to_point'
                  ? copy.pointToPoint
                  : null,
            expiry:
              trail.hours != null && trail.hours > 0
                ? copy.expires.replace('{n}', String(trail.hours))
                : null,
            claimed: trail.claimed,
            kicker: copy.signed,
            // Only iOS is asked. There is no Android build to offer, and on desktop the
            // question has no good answer.
            app: isIOSUA(request.headers.get('user-agent'))
              ? {
                  prompt: copy.appPrompt,
                  recommended: copy.recommended,
                  yes: appCopy.openInAppLabel,
                  web: appCopy.webCtaLabel,
                  appURL: `dirtbikex://s/c/${encodeURIComponent(code)}`,
                  storeURL: APP_STORE_URL,
                }
              : undefined,
          }
        : undefined,
      primaryCTA: {
        // Same destination either way — the forum knows who is asking and routes an owner
        // to their message. Only the promise on the button changes.
        label: trail?.claimed ? copy.claimedCta : copy.cta,
        url: `${env.FORUM_BASE}/dbx/trails/claim?code=${encodeURIComponent(code)}`,
      },
      secondaryLink: trail ? { label: copy.backToMap, url: `/?trail=${encodeURIComponent(trail.id)}` } : undefined,
      returnTapCopy: '',
      forumBase: env.FORUM_BASE ?? '',
    },
    request.url,
    // Still no-store. The page is now identical for every code, but the URL carries a
    // bearer credential and must not be logged into an edge cache alongside a response.
    { cacheControl: 'no-store' },
  );
}

async function handleLineageClaim(request: Request, env: Env): Promise<Response> {
  const ctx = lineageContext(request, env);
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const upstreamPath = token
    ? `/dirtbikex/lineage/claims/${encodeURIComponent(token)}/preview.json`
    : ' (no token — nothing was fetched)';

  // The token is the only credential on this page, so it never reaches the
  // panel — an operator sharing a debug screenshot must not be sharing a claim.
  const panel = (
    payload: DebugPayload,
    result: { status: string; httpStatus?: number | null; reason?: string },
    ms: number
  ) =>
    ctx.debug
      ? debugPanel(
          lineageTrace(
            request,
            ctx,
            { route: '/lineage/claim', param: token ? '(token withheld)' : '(missing)', ref: '—', upstreamPath, ms, result },
            ctx.url
          ),
          payload,
          ctx.facetLabels
        )
      : null;

  if (!token) {
    return renderLineageNotFound(
      ctx.locale,
      ctx.url,
      panel({ kind: 'none' }, { status: 'no_token', httpStatus: null }, 0)
    );
  }

  const started = Date.now();
  const result = await lookupClaimPreview(env, token);
  const ms = Date.now() - started;

  if (result.status !== 'valid') {
    return renderLineageNotFound(ctx.locale, ctx.url, panel({ kind: 'none' }, result, ms));
  }
  return renderClaim(result.data, {
    ...ctx,
    token,
    debug: panel({ kind: 'claim', data: result.data }, result, ms),
  });
}

/** JSON passthrough for the map/app; same anonymous projection the page renders. */
async function handleLineageJSON(request: Request, env: Env): Promise<Response> {
  const ref = new URL(request.url).searchParams.get('r') ?? '';
  if (!ref) return new Response('{"error":"missing r"}', { status: 400, headers: JSON_HEADERS });

  const result = await lookupResume(env, ref);
  if (result.status === 'not_found') return new Response('{"error":"not_found"}', { status: 404, headers: JSON_HEADERS });
  if (result.status === 'unreachable') return new Response('{"error":"unreachable"}', { status: 502, headers: JSON_HEADERS });
  return new Response(JSON.stringify(result.data), { headers: JSON_HEADERS });
}

async function handleLineageTrackJSON(request: Request, env: Env): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  if (!slug) return new Response('{"error":"missing slug"}', { status: 400, headers: JSON_HEADERS });

  const result = await lookupTrackContributors(env, slug);
  if (result.status === 'not_found') return new Response('{"error":"not_found"}', { status: 404, headers: JSON_HEADERS });
  if (result.status === 'unreachable') return new Response('{"error":"unreachable"}', { status: 502, headers: JSON_HEADERS });
  return new Response(JSON.stringify(result.data), { headers: JSON_HEADERS });
}

/**
 * One track by slug, for the sheet's owner byline. The map's baked catalog is a
 * deploy-cadence artefact and cannot carry who claimed a track this morning, so
 * the sheet asks for that separately and only once it is already open.
 */
async function handleTrackJSON(request: Request, env: Env): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  if (!slug || !env.FORUM_BASE) return new Response('{"error":"missing slug"}', { status: 400, headers: JSON_HEADERS });

  const resp = await fetch(`${env.FORUM_BASE}/dirtbikex/tracks/${encodeURIComponent(slug)}.json`, {
    headers: { Accept: 'application/json' },
    ...({ cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit),
  }).catch(() => null);
  if (!resp?.ok) return new Response('{"error":"not_found"}', { status: 404, headers: JSON_HEADERS });

  return new Response(await resp.text(), { headers: JSON_HEADERS });
}

/** The riders map layer; gated server-side, so a 404 here just means "no layer". */
async function handleLineageRidersJSON(env: Env): Promise<Response> {
  const result = await lookupRiderPins(env);
  if (result.status !== 'valid') {
    return new Response('{"riders":[]}', { headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify(result.data), { headers: JSON_HEADERS });
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=60, s-maxage=300',
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/s\/i\/([^/]+)\/?$/);
    if (m && request.method === 'GET') {
      return handleInvite(request, env, m[1]);
    }
    const su = url.pathname.match(/^\/s\/u\/([^/]+)\/?$/);
    if (su && request.method === 'GET') {
      return handleUser(request, env, decodeURIComponent(su[1]));
    }
    // Trail claim. Alphabet-scoped so a typo 404s at the router rather than in D1.
    const sc = url.pathname.match(/^\/s\/c\/([a-z0-9]{6,16})\/?$/);
    if (sc && request.method === 'GET') {
      return await handleTrailClaim(request, env, sc[1]!);
    }
    const se = url.pathname.match(/^\/s\/e\/([^/]+)\/?$/);
    if (se && request.method === 'GET') {
      return handleEvent(request, env, decodeURIComponent(se[1]));
    }
    // Web-only shares live under `/share/`, NOT `/s/`.
    //
    // Narrowing AASA to exclude `/s/route/*` was correct and did not work: iOS
    // caches the association file and only re-reads it reliably on app install
    // or update, so every device already carrying the old broad `/s/*` claim
    // keeps opening the app — which cannot route these kinds, so it raises its
    // invalid-link bubble. A different prefix is immune by construction: no
    // AASA ever claimed `/share/*`, cached or otherwise.
    //
    // `/s/i`, `/s/u` and `/s/e` stay where they are; those are the kinds the app
    // genuinely handles, and their links are already in the wild.
    const shareAlias = url.pathname.match(/^\/s\/(tr|ta|sh|ch|l)\/(.+)$/);
    if (shareAlias && request.method === 'GET') {
      const to = new URL(request.url);
      to.pathname = `/share/${SHARE_ALIASES[shareAlias[1]!]}/${shareAlias[2]!}`;
      return Response.redirect(to.toString(), 301);
    }
    const shareWord = url.pathname.match(/^\/s\/(route|track|shop|challenge|lineage)\/(.+)$/);
    if (shareWord && request.method === 'GET') {
      const to = new URL(request.url);
      to.pathname = `/share/${shareWord[1]!}/${shareWord[2]!}`;
      return Response.redirect(to.toString(), 301);
    }
    const sm = url.pathname.match(/^\/share\/(route|track|shop|challenge)\/([^/]+)\/?$/);
    if (sm && request.method === 'GET') {
      return handleEntity(request, env, sm[1]!, decodeURIComponent(sm[2]!));
    }
    const slw = url.pathname.match(/^\/share\/lineage\/([^/]+)\/?$/);
    if (slw && request.method === 'GET') {
      const param = decodeURIComponent(slw[1]!);
      return handleLineagePage(request, env, shareLineageRef(param), '/share/lineage/', param);
    }
    // Rider lineage — the public read surface (agents.d/modules/lineage.md). Reads are
    // anonymous plugin endpoints, so no key and no CORS is involved; every write
    // stays in the forum, which is the only place a visitor has a session.
    const lineagePage = url.pathname.match(/^\/lineage\/(@?[A-Za-z0-9._\-]+)\/?$/);
    if (lineagePage && request.method === 'GET' && lineagePage[1] !== 'claim') {
      const param = decodeURIComponent(lineagePage[1]!);
      return handleLineagePage(request, env, param, '/lineage/', param);
    }
    if (url.pathname === '/lineage/claim' && request.method === 'GET') {
      return handleLineageClaim(request, env);
    }

    if (request.method === 'GET') {
      if (url.pathname === '/api/lineage/rider.json') return handleLineageJSON(request, env);
      if (url.pathname === '/api/lineage/track.json') return handleLineageTrackJSON(request, env);
      if (url.pathname === '/api/lineage/riders.json') return handleLineageRidersJSON(env);
      if (url.pathname === '/api/forum/metrics.json') return handleForumMetrics(env);
      if (url.pathname === '/api/forum/featured.json') return handleForumFeatured(env);
      // World map story data — R2 projection with the committed seed as fallback.
      if (url.pathname === '/api/map/series.json') return handleMapDoc(request, env, ctx, 'series');
      if (url.pathname === '/api/map/trails.json') {
        // Curated fixture first, visitor uploads merged over it. Uploads never enter the
        // R2 document — see agents.d/modules/trail-upload.md.
        return handleMapDoc(request, env, ctx, 'trails', async (doc) => {
          const curated = Array.isArray(doc.trails) ? doc.trails : [];
          return { ...doc, trails: [...curated, ...(await publicTrailEntries(env))] };
        });
      }
      // Plugin-only, bearer-checked, and 404 rather than 401 when it fails — an
      // unauthorised caller learns nothing about what lives here.
      if (url.pathname === '/api/map/trails/admin.json') return handleTrailsAdmin(request, env);
      const claimResolve = url.pathname.match(/^\/api\/map\/trail\/claim\/([a-z0-9]{6,16})$/);
      if (claimResolve) return handleClaimResolve(request, env, claimResolve[1]!);
      const trailDoc = url.pathname.match(/^\/api\/map\/trail\/([a-z0-9]{6,16})\.json$/);
      if (trailDoc) return handleTrailResolve(env, trailDoc[1]!);
      const trailGpx = url.pathname.match(/^\/api\/map\/trail\/([a-z0-9]{6,16})\.gpx$/);
      if (trailGpx) return handleTrailGpx(env, trailGpx[1]!);
      if (url.pathname === '/api/map/upload.json') return handleUploadStatus(env);
      if (url.pathname === '/api/map/shops.json') return handleMapDoc(request, env, ctx, 'shops');
      if (url.pathname === '/api/map/track.json') return handleTrackJSON(request, env);
      if (url.pathname === '/api/map/og') return handleOgPreview(request, env, ctx);
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
    // See worker/_lib/outreach.ts + agents.d/modules/outreach.md.
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

    // The uploader changing their mind, authorised by the secret alone — see
    // handleTrailDelete for why that is the right credential and a fingerprint is not.
    if (request.method === 'DELETE') {
      const gone = url.pathname.match(/^\/api\/map\/trail\/([a-z0-9]{6,16})$/);
      if (gone) return handleTrailDelete(request, env, gone[1]!);
    }

    // The claim card as data, for the app. Unauthenticated like the page it mirrors.
    {
      const peek = url.pathname.match(/^\/api\/map\/claim\/([a-z0-9]{6,16})\.json$/);
      if (peek && request.method === 'GET') return handleClaimPeek(request, env, peek[1]!);
    }

    // Visitor trail upload — the one unauthenticated write on this worker.
    if (url.pathname === '/api/map/trail' && request.method === 'POST') {
      return handleTrailUpload(request, env);
    }
    // The other direction: the plugin turning somebody's own public post into a trail.
    if (url.pathname === '/api/map/trail/import' && request.method === 'POST') {
      return handleTrailImport(request, env);
    }
    if (request.method === 'POST') {
      const claimBind = url.pathname.match(/^\/api\/map\/trail\/claim\/([a-z0-9]{6,16})$/);
      if (claimBind) return handleClaimBind(request, env, claimBind[1]!);
      const trailState = url.pathname.match(/^\/api\/map\/trail\/([a-z0-9]{6,16})\/state$/);
      if (trailState) return handleTrailState(request, env, trailState[1]!);
    }

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
    // Log every tick's DripResult. The counters were previously discarded, so a stalled drip
    // (cap spent, rate-limited, misconfigured) produced ZERO signal — a 24-minute outage was
    // found by a human eyeballing the CRM, and diagnosing it needed hand-run D1 queries.
    ctx.waitUntil((async () => {
      try {
        console.log('outreach:drip', await runDrip(env, { dry: false }));
      } catch (err) {
        // Log, then RE-THROW. Swallowing it here would hide the failure from Cloudflare's cron
        // error metrics — the one signal that fires without anyone running `wrangler tail`.
        console.error('outreach:drip_threw', { err: String(err) });
        throw err;
      }
    })());

    // Unclaimed trails expire. Their FILES expire independently, reaped by Discourse once
    // the grace period passes an upload nothing references — this only clears the index, so
    // a failed sweep leaves a row pointing at a file that is already gone rather than the
    // other way round. Logged and swallowed: a sweep failure must not mask a drip failure,
    // which is the signal this cron exists for.
    ctx.waitUntil((async () => {
      try {
        const dropped = await sweepExpiredTrails(env);
        if (dropped > 0) console.log('trail:swept', { dropped });
      } catch (err) {
        console.error('trail:sweep_threw', { err: String(err) });
      }
      // Pull, after the sweep: a claim recorded only on the forum side would otherwise be
      // swept away a minute before the pull that would have made it permanent.
      try {
        const applied = await reconcileTrails(env);
        if (applied > 0) console.log('trail:reconciled', { applied });
      } catch (err) {
        console.error('trail:reconcile_threw', { err: String(err) });
      }
      // Last, and only ever one: an imported trail arrives unsigned because the signature
      // has exactly one implementation and it is not reachable from the forum. Signing
      // means fetching and resampling a whole ride, which belongs in a cron invocation's
      // CPU allowance rather than a rider's request.
      try {
        const signed = await signPendingTrails(env);
        if (signed > 0) console.log('trail:signed', { signed });
      } catch (err) {
        console.error('trail:sign_threw', { err: String(err) });
      }
    })());
  },
};
