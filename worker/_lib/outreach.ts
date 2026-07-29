// outreach.ts — the PRE-INVITE cold-outreach email: the thin first touch to a track
// operator ("we built DirtBikeX, interested?"), NO code / invite link / QR. Two surfaces:
//   • single TEST send  — POST /api/outreach/test (bearer), one email you type.
//   • BATCH pipeline    — POST /api/outreach/batch enqueues into the D1 send-once ledger
//     (`outreach`), a Cron (or POST /api/outreach/drip) drips it out, /api/outreach/status
//     reports jobs, /api/outreach/u is the tokened one-click unsubscribe.
// Sender is Resend, From joindirtbikex.com (the reputation-isolated identity, same as the
// join confirmation email). See docs/OUTREACH_MODULE.md §"Batch outreach".
import type { D1Database, PagesEnv } from './types';

// personalization is TRACK NAME only (no owner greeting, by design)
export interface PreInvitePayload {
  to: string;
  trackName: string;
  locale: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// One localized block per language. `en` is the base and the fallback; a non-English
// send stacks the local block ABOVE the English one in a single email (send-once
// forbids two emails to one address). The English copy is finalized; per-language
// translations go in LOCALES below (same fields), then redeploy.
interface Block {
  subject: string; lead: string; intro: string; value: string; cta: string; look: string;
  /** Quiet 4-step timeline (step 1 = this email, arrow "you are here"). EN-only until the
   *  locale pass — absent means the block renders without it. */
  steps?: { title: string; got: string; reply: string; invite: string; install: string; here: string };
  /** Single early-supporter line rendered between the timeline and the cta. EN-only for now. */
  early?: string;
}

// Sign-off + social footer are constant across languages (a name/brand/handle isn't
// translated). SOCIALS mirrors the site's src/config.ts (duplicated because this Pages
// Function bundles separately from the Astro app); footer taps go straight to the handle.
const SIGNATURE = '— Rubio, DirtBikeX';
const SOCIALS: ReadonlyArray<readonly [string, string]> = [
  ['Facebook', 'https://www.facebook.com/people/Dirt-Bike-X/61592048966883/'],
  ['Instagram', 'https://www.instagram.com/teamdirtbikex/'],
  ['X', 'https://x.com/teamdirtbikex'],
];

const EN: Block = {
  subject: 'A community built just for tracks like {track}',
  lead: 'Hi {track} team,',
  intro:
    "I'm Rubio — a rider who writes software for a living, and I'm building DirtBikeX: a community made "
    + "specifically for dirt-bike and motocross people. It's available on iOS and desktop now — not another "
    + "feed to manage, but a focused, forum-based place with no noise, where everyone there is there to ride.",
  value:
    "I'd like to give {track} a free page in it. Your own channels already reach the riders who know you — "
    + "this is for the ones who don't yet: riders searching the map for somewhere to ride, traveling through, "
    + "or new to the sport. One global track catalog, and {track} is on it.",
  cta: "If you're in, just reply.",
  look: "Here's a 30-second look:",
  steps: {
    title: "Getting {track} on DirtBikeX — four small steps:",
    got: "You got this note",
    reply: "You reply to agree",
    invite: "I send your personal invite",
    install: "You install the app — your page is live",
    here: "you are here",
  },
  early: "We're early-stage — the first tracks on board shape what gets built, and early supporters will be rewarded as DirtBikeX grows.",
};

// Local-language blocks. A non-English send stacks the local block above the English one.
// Keys match the CRM's language codes (db.LANGUAGES). {track} is preserved; DirtBikeX /
// Rubio / iOS stay untranslated. Native-speaker review advised before large real sends.
const LOCALES: Record<string, Block> = {
  zh_CN: {
    subject: "专为像 {track} 这样的场地打造的社区",
    lead: "{track} 团队，你们好：",
    intro: "我是 Rubio——一名平时靠写代码谋生的车手，正在打造 DirtBikeX：一个专为越野摩托和摩托越野人群而生的社区。现已支持 iOS 和桌面端——它不是又一个需要你打理的信息流，而是一个专注、以论坛为核心、没有噪音的地方，来这里的每个人都是为了骑行。",
    value: "我想在上面免费给 {track} 建一个主页：让车手找到你、关注你、收到你的更新。它不会取代你现有的触达方式——只是把你呈现在最在乎的人面前。",
    cta: "设置的事我来帮你搞定。有兴趣的话，直接回复即可——我会发给你一个专属邀请，用来下载 App。",
    look: "花 30 秒看一下：",
  },
  ja: {
    subject: "{track} のようなコースのためだけに作ったコミュニティ",
    lead: "{track} チームのみなさま、",
    intro: "はじめまして、Rubio と申します。普段はソフトウェアを書いて生計を立てているライダーで、DirtBikeX を作っています。ダートバイクとモトクロスに関わる人たちのためだけのコミュニティです。今は iOS とデスクトップで使えます。管理が増えるだけの新しいフィードではなく、ノイズのない、フォーラム中心の集中できる場所で、そこにいる誰もが走るために来ています。",
    value: "その中で {track} の無料プロフィールをご用意したいと思っています。ライダーがあなたを見つけ、フォローし、更新を受け取れる場所です。今の連絡手段を置き換えるものではなく、いちばん関心のある人たちの前にあなたを届けるだけです。",
    cta: "セットアップはこちらで対応します。ご興味があれば、このまま返信してください。アプリ用の専用招待をお送りします。",
    look: "30 秒の紹介はこちら：",
  },
  zh_TW: {
    subject: "專為像 {track} 這樣的場地打造的社群",
    lead: "{track} 團隊，您好：",
    intro: "我是 Rubio——一名平時靠寫程式維生的車手，正在打造 DirtBikeX：一個專為越野摩托與越野賽車愛好者而生的社群。現已支援 iOS 與桌面版——它不是又一個要你打理的動態牆，而是一個專注、以論壇為核心、沒有雜訊的地方，來這裡的每個人都是為了騎乘。",
    value: "我想在上面免費為 {track} 建立一個主頁：讓車手找到你、追蹤你、收到你的最新消息。它不會取代你現有的觸及方式——只是把你呈現在最在乎的人面前。",
    cta: "設定的部分我來幫你處理。有興趣的話，直接回覆即可——我會寄給你一個專屬邀請，用來下載 App。",
    look: "花 30 秒看一下：",
  },
  ko: {
    subject: "{track} 같은 트랙만을 위한 커뮤니티",
    lead: "{track} 팀 여러분, 안녕하세요.",
    intro: "저는 Rubio입니다. 소프트웨어를 만들며 먹고사는 라이더이고, DirtBikeX를 만들고 있어요. 더트바이크와 모토크로스에 관련된 사람들만을 위한 커뮤니티입니다. 지금은 iOS와 데스크톱에서 사용할 수 있어요. 또 하나 관리해야 할 피드가 아니라, 소음 없이 포럼 중심으로 집중된 공간이고, 여기 있는 모두가 오직 라이딩을 위해 모입니다.",
    value: "그 안에 {track}의 무료 프로필을 만들어 드리고 싶어요. 라이더들이 여러분을 찾고, 팔로우하고, 소식을 받아보는 공간입니다. 기존의 소통 방식을 대체하지 않아요. 그저 가장 관심 있는 사람들 앞에 여러분을 놓아줄 뿐입니다.",
    cta: "설정은 제가 다 해드릴게요. 관심 있으시면 이 메일에 답장만 주세요 — 앱 설치용 개인 초대장을 보내드릴게요.",
    look: "30초짜리 영상으로 보기:",
  },
  de: {
    subject: "Eine Community, gemacht für Strecken wie {track}",
    lead: "Hallo Team von {track},",
    intro: "Ich bin Rubio – Fahrer und hauptberuflich Softwareentwickler – und ich baue DirtBikeX: eine Community speziell für Dirtbike- und Motocross-Leute. Ab sofort für iOS und Desktop verfügbar – kein weiterer Feed, den du pflegen musst, sondern ein fokussierter, forumbasierter Ort ohne Rauschen, an dem alle nur zum Fahren da sind.",
    value: "Ich würde {track} dort gern ein kostenloses Profil einrichten: ein Ort, an dem Fahrer dich finden, dir folgen und deine Updates bekommen. Es ersetzt nicht, wie du deine Leute schon erreichst – es bringt dich einfach vor die, denen es am meisten bedeutet.",
    cta: "Um die Einrichtung kümmere ich mich. Bei Interesse antworte einfach auf diese Mail – ich schicke dir eine persönliche Einladung für die App.",
    look: "Hier ein 30-Sekunden-Einblick:",
  },
  it: {
    subject: "Una community fatta apposta per piste come {track}",
    lead: "Ciao team di {track},",
    intro: "Sono Rubio – rider e sviluppatore software di professione – e sto costruendo DirtBikeX: una community pensata solo per chi vive il mondo delle dirt bike e del motocross. Ora disponibile su iOS e desktop – non un altro feed da gestire, ma un posto concentrato, basato su forum e senza rumore, dove chi c'è è lì solo per andare in moto.",
    value: "Mi piacerebbe creare lì un profilo gratuito per {track}: un posto dove i rider ti trovano, ti seguono e ricevono i tuoi aggiornamenti. Non sostituisce come raggiungi già la gente – ti mette solo davanti a chi tiene di più.",
    cta: "Alla configurazione ci penso io. Se ti va, rispondi pure a questa email: ti mando un invito personale per l'app.",
    look: "Ecco uno sguardo di 30 secondi:",
  },
  fr: {
    subject: "Une communauté faite pour des pistes comme {track}",
    lead: "Bonjour l'équipe de {track},",
    intro: "Je suis Rubio – pilote et développeur de logiciels au quotidien – et je construis DirtBikeX : une communauté pensée uniquement pour les passionnés de dirt bike et de motocross. Disponible dès maintenant sur iOS et ordinateur – pas un énième fil à gérer, mais un endroit ciblé, basé sur un forum et sans bruit, où tout le monde est là pour rouler.",
    value: "J'aimerais y créer un profil gratuit pour {track} : un endroit où les pilotes te trouvent, te suivent et reçoivent tes actus. Ça ne remplace pas ta façon de toucher les gens – ça te met juste devant ceux que ça intéresse le plus.",
    cta: "Je m'occupe de tout mettre en place. Si ça t'intéresse, réponds simplement à cet e-mail — je t'enverrai une invitation personnelle pour l'appli.",
    look: "Un aperçu en 30 secondes :",
  },
  es: {
    subject: "Una comunidad hecha para pistas como {track}",
    lead: "Hola equipo de {track},",
    intro: "Soy Rubio, piloto y programador de profesión, y estoy creando DirtBikeX: una comunidad pensada solo para la gente del dirt bike y el motocross. Ya disponible en iOS y escritorio; no es otro feed más que gestionar, sino un lugar centrado, basado en foro y sin ruido, donde todos están para rodar.",
    value: "Me gustaría crear ahí un perfil gratis para {track}: un sitio donde los pilotos te encuentren, te sigan y reciban tus novedades. No reemplaza cómo ya llegas a la gente; solo te pone frente a quienes más les importa.",
    cta: "De la configuración me encargo yo. Si te interesa, responde a este correo y te mando una invitación personal para la app.",
    look: "Aquí tienes un vistazo de 30 segundos:",
  },
  ar: {
    subject: "مجتمع مصنوع خصيصًا لحلبات مثل {track}",
    lead: "مرحبًا فريق {track}،",
    intro: "أنا Rubio، سائق أعمل في تطوير البرمجيات، وأبني DirtBikeX: مجتمع مخصّص لعشّاق الدراجات الترابية والموتوكروس. متاح الآن على iOS وسطح المكتب — ليس مجرد موجز آخر عليك إدارته، بل مكان مركّز قائم على المنتدى وبلا ضجيج، كل من فيه موجود ليقود فقط.",
    value: "أودّ أن أنشئ لـ {track} ملفًا مجانيًا هناك: مكان يجدك فيه السائقون ويتابعونك ويصلهم جديدك. لن يحلّ محلّ طريقتك الحالية في الوصول إلى الناس — إنما يضعك أمام الأكثر اهتمامًا فقط.",
    cta: "سأتولّى الإعداد بنفسي. إن كنت مهتمًا، فقط ردّ على هذه الرسالة — وسأرسل لك دعوة شخصية لتحميل التطبيق.",
    look: "إليك لمحة في 30 ثانية:",
  },
  da: {
    subject: "Et fællesskab skabt til baner som {track}",
    lead: "Hej {track}-team,",
    intro: "Jeg er Rubio – kører og softwareudvikler til daglig – og jeg bygger DirtBikeX: et fællesskab lavet specifikt til dirtbike- og motocross-folk. Nu tilgængeligt på iOS og computer – ikke endnu et feed, du skal passe, men et fokuseret, forumbaseret sted uden støj, hvor alle er der for at køre.",
    value: "Jeg vil gerne oprette en gratis profil til {track} derinde: et sted, hvor kørere finder dig, følger dig og får dine opdateringer. Det erstatter ikke, hvordan du allerede når folk – det stiller dig bare foran dem, der er mest interesserede.",
    cta: "Jeg klarer opsætningen for dig. Er du nysgerrig, så svar bare på denne mail – så sender jeg dig en personlig invitation til appen.",
    look: "Her er et kig på 30 sekunder:",
  },
  el: {
    subject: "Μια κοινότητα φτιαγμένη για πίστες σαν την {track}",
    lead: "Γεια σας, ομάδα της {track},",
    intro: "Είμαι ο Rubio — αναβάτης και επαγγελματίας προγραμματιστής — και φτιάχνω το DirtBikeX: μια κοινότητα φτιαγμένη αποκλειστικά για τους ανθρώπους του dirt bike και του motocross. Διαθέσιμο τώρα σε iOS και υπολογιστή — όχι άλλο ένα feed για να διαχειρίζεσαι, αλλά ένας εστιασμένος χώρος βασισμένος σε φόρουμ, χωρίς θόρυβο, όπου όλοι είναι εκεί μόνο για να καβαλήσουν.",
    value: "Θα ήθελα να φτιάξω εκεί ένα δωρεάν προφίλ για την {track}: ένα μέρος όπου οι αναβάτες σε βρίσκουν, σε ακολουθούν και λαμβάνουν τα νέα σου. Δεν αντικαθιστά τον τρόπο που ήδη επικοινωνείς — απλώς σε βάζει μπροστά σε αυτούς που ενδιαφέρονται περισσότερο.",
    cta: "Τη ρύθμιση την αναλαμβάνω εγώ. Αν σε ενδιαφέρει, απλώς απάντησε σε αυτό το email — θα σου στείλω μια προσωπική πρόσκληση για την εφαρμογή.",
    look: "Δείτε το σε 30 δευτερόλεπτα:",
  },
  sv: {
    subject: "En gemenskap gjord för banor som {track}",
    lead: "Hej {track}-teamet,",
    intro: "Jag heter Rubio – förare och mjukvaruutvecklare till vardags – och jag bygger DirtBikeX: en gemenskap gjord specifikt för dirtbike- och motocrossfolk. Nu tillgänglig för iOS och dator – inte ännu ett flöde att sköta, utan en fokuserad, forumbaserad plats utan brus, där alla är där för att köra.",
    value: "Jag vill gärna skapa en gratis profil för {track} där: en plats där förare hittar dig, följer dig och får dina uppdateringar. Den ersätter inte hur du redan når folk – den ställer dig bara framför dem som bryr sig mest.",
    cta: "Jag fixar uppsättningen åt dig. Är du nyfiken, svara bara på det här mejlet – så skickar jag en personlig inbjudan till appen.",
    look: "Här är en titt på 30 sekunder:",
  },
  th: {
    subject: "คอมมูนิตี้ที่สร้างมาเพื่อสนามอย่าง {track} โดยเฉพาะ",
    lead: "สวัสดีทีมงาน {track}",
    intro: "ผมชื่อ Rubio เป็นนักขี่ที่ทำงานเขียนซอฟต์แวร์เป็นอาชีพ และกำลังสร้าง DirtBikeX คอมมูนิตี้ที่ทำมาเพื่อคนสายเดิร์ทไบก์และโมโตครอสโดยเฉพาะ ตอนนี้ใช้ได้ทั้งบน iOS และเดสก์ท็อป ไม่ใช่ฟีดอีกอันที่คุณต้องคอยดูแล แต่เป็นพื้นที่ที่โฟกัส เน้นฟอรัม ไม่มีสิ่งรบกวน และทุกคนที่นี่มาเพื่อขี่จริง ๆ",
    value: "ผมอยากสร้างโปรไฟล์ฟรีให้ {track} ในนั้น เป็นที่ที่นักขี่จะเจอคุณ ติดตามคุณ และรับข่าวสารจากคุณ มันไม่ได้มาแทนช่องทางที่คุณใช้อยู่ แต่ช่วยพาคุณไปอยู่ตรงหน้าคนที่สนใจมากที่สุด",
    cta: "เรื่องตั้งค่าผมจัดการให้เอง ถ้าสนใจ ตอบกลับอีเมลนี้ได้เลย แล้วผมจะส่งคำเชิญส่วนตัวสำหรับดาวน์โหลดแอปให้ครับ",
    look: "ดูคลิป 30 วินาทีได้ที่นี่:",
  },
  id: {
    subject: "Komunitas yang dibuat khusus untuk trek seperti {track}",
    lead: "Halo tim {track},",
    intro: "Saya Rubio — seorang rider yang sehari-hari menulis perangkat lunak — dan saya membangun DirtBikeX: komunitas yang dibuat khusus untuk orang-orang dirt bike dan motocross. Sekarang tersedia di iOS dan desktop — bukan satu feed lagi yang harus kamu urus, tapi tempat yang fokus, berbasis forum, tanpa gangguan, di mana semua yang ada di sana hadir untuk riding.",
    value: "Saya ingin membuatkan {track} profil gratis di sana: tempat para rider menemukanmu, mengikutimu, dan mendapatkan kabar terbarumu. Ini tidak menggantikan cara kamu menjangkau orang selama ini — hanya menempatkanmu di depan mereka yang paling peduli.",
    cta: "Soal pengaturan biar saya yang urus. Kalau tertarik, cukup balas email ini — nanti saya kirim undangan pribadi untuk aplikasinya.",
    look: "Ini cuplikan 30 detik:",
  },
  pt: {
    subject: "Uma comunidade feita para pistas como a {track}",
    lead: "Olá, equipe da {track},",
    intro: "Sou o Rubio — piloto e desenvolvedor de software de profissão — e estou criando o DirtBikeX: uma comunidade feita só para a galera do dirt bike e do motocross. Já disponível para iOS e desktop — não é mais um feed para você gerenciar, mas um lugar focado, baseado em fórum e sem ruído, onde todo mundo está ali só para pilotar.",
    value: "Eu gostaria de criar um perfil gratuito para a {track} nela: um lugar onde os pilotos te encontram, te seguem e recebem suas novidades. Não substitui como você já alcança as pessoas — só coloca você na frente de quem mais se importa.",
    cta: "Da configuração eu cuido. Se tiver interesse, é só responder a este e-mail — eu te mando um convite pessoal para o app.",
    look: "Aqui vai um olhar de 30 segundos:",
  },
  fa_IR: {
    subject: "جامعه‌ای که مخصوص پیست‌هایی مثل {track} ساخته شده",
    lead: "سلام تیم {track}،",
    intro: "من Rubio هستم؛ یک موتورسوار که کارش برنامه‌نویسی است و دارم DirtBikeX را می‌سازم: جامعه‌ای که مخصوص آدم‌های دنیای درت‌بایک و موتوکراس ساخته شده. حالا روی iOS و دسکتاپ در دسترس است — نه یک فید دیگر که باید مدیریتش کنی، بلکه جایی متمرکز و مبتنی بر انجمن و بدون شلوغی، که هر کسی آنجاست فقط برای رایدینگ آمده.",
    value: "دوست دارم آنجا برای {track} یک پروفایل رایگان بسازم: جایی که موتورسوارها پیدایت می‌کنند، دنبالت می‌کنند و به‌روزرسانی‌هایت را می‌گیرند. جای روش فعلی‌ات برای رسیدن به مردم را نمی‌گیرد — فقط تو را جلوی چشم کسانی می‌گذارد که بیشتر از همه برایشان مهم است.",
    cta: "راه‌اندازی‌اش با من. اگر علاقه‌مندی، کافی است همین ایمیل را پاسخ بدهی — یک دعوت‌نامهٔ شخصی برای اپ برایت می‌فرستم.",
    look: "یک نگاه ۳۰ ثانیه‌ای:",
  },
  fi: {
    subject: "Yhteisö, joka on tehty {track}:n kaltaisille radoille",
    lead: "Hei {track}-tiimi,",
    intro: "Olen Rubio – kuljettaja ja työkseni ohjelmistokehittäjä – ja rakennan DirtBikeX:ää: yhteisöä, joka on tehty vain dirtbike- ja motocross-väelle. Nyt saatavilla iOS:lle ja tietokoneelle – ei taas yksi syöte hallittavaksi, vaan keskittynyt, foorumipohjainen paikka ilman kohinaa, jossa kaikki ovat vain ajamista varten.",
    value: "Haluaisin tehdä {track}:lle sinne ilmaisen profiilin: paikan, josta kuljettajat löytävät sinut, seuraavat sinua ja saavat päivityksesi. Se ei korvaa tapaa, jolla jo tavoitat ihmiset – se vain tuo sinut niiden eteen, joita se eniten kiinnostaa.",
    cta: "Hoidan käyttöönoton puolestasi. Jos kiinnostuit, vastaa vain tähän viestiin – lähetän sinulle henkilökohtaisen kutsun sovellukseen.",
    look: "Tässä 30 sekunnin katsaus:",
  },
  nl: {
    subject: "Een community gemaakt voor banen zoals {track}",
    lead: "Hallo team van {track},",
    intro: "Ik ben Rubio – rijder en van beroep softwareontwikkelaar – en ik bouw DirtBikeX: een community speciaal voor dirtbike- en motocrossmensen. Nu beschikbaar op iOS en desktop – niet nóg een feed om te beheren, maar een gerichte, forumgebaseerde plek zonder ruis, waar iedereen er is om te rijden.",
    value: "Ik wil daar graag een gratis profiel voor {track} aanmaken: een plek waar rijders je vinden, je volgen en je updates krijgen. Het vervangt niet hoe je mensen nu al bereikt – het zet je alleen voor de mensen die er het meest om geven.",
    cta: "De installatie regel ik voor je. Heb je interesse, reageer dan gewoon op deze mail – dan stuur ik je een persoonlijke uitnodiging voor de app.",
    look: "Hier is een blik van 30 seconden:",
  },
  tr_TR: {
    subject: "{track} gibi pistler için özel yapılmış bir topluluk",
    lead: "Merhaba {track} ekibi,",
    intro: "Ben Rubio — hem sürücü hem de mesleği yazılım geliştirmek olan biri — ve DirtBikeX'i geliştiriyorum: dirt bike ve motokros dünyasının insanları için özel olarak yapılmış bir topluluk. Artık iOS ve masaüstünde kullanılabiliyor — yönetmen gereken bir akış daha değil, odaklanmış, forum tabanlı, gürültüsüz bir yer; oradaki herkes yalnızca sürmek için orada.",
    value: "Orada {track} için ücretsiz bir profil oluşturmak isterim: sürücülerin seni bulduğu, takip ettiği ve güncellemelerini aldığı bir yer. İnsanlara zaten ulaşma şeklinin yerini almaz — seni yalnızca en çok önemseyenlerin önüne çıkarır.",
    cta: "Kurulumu senin için ben hallederim. İlgileniyorsan bu e-postayı yanıtlaman yeterli — sana uygulama için kişisel bir davet gönderirim.",
    look: "30 saniyelik bir bakış:",
  },
  vi: {
    subject: "Một cộng đồng dành riêng cho những đường đua như {track}",
    lead: "Chào đội ngũ {track},",
    intro: "Tôi là Rubio — một tay đua đồng thời làm nghề viết phần mềm — và tôi đang xây dựng DirtBikeX: một cộng đồng dành riêng cho những người chơi dirt bike và motocross. Hiện đã có trên iOS và máy tính — không phải thêm một bảng tin để bạn quản lý, mà là một nơi tập trung, dựa trên diễn đàn, không nhiễu, nơi ai cũng đến chỉ để chạy xe.",
    value: "Tôi muốn tạo cho {track} một hồ sơ miễn phí trong đó: nơi các tay đua tìm thấy bạn, theo dõi bạn và nhận tin cập nhật từ bạn. Nó không thay thế cách bạn đang tiếp cận mọi người — chỉ đưa bạn đến trước những người quan tâm nhất.",
    cta: "Việc thiết lập cứ để tôi lo. Nếu bạn quan tâm, chỉ cần trả lời email này — tôi sẽ gửi cho bạn lời mời cá nhân để tải ứng dụng.",
    look: "Xem thử trong 30 giây:",
  },
};

function fill(s: string, track: string): string {
  return s.replace(/\{track\}/g, track);
}

// ---- intro links ------------------------------------------------------------
// The intro names three things the reader can't otherwise see: the product, the iOS app, and
// the web forum. Each becomes tappable IN PLACE — no words are added, so the paragraph keeps
// its original length and rhythm. The CTA stays "just reply"; these are evidence, not a CTA.
const SITE_URL = 'https://www.dirtbikex.com';
const SITE_LABEL = 'www.dirtbikex.com';
const BRAND = 'DirtBikeX';
const APP_STORE_URL = 'https://apps.apple.com/app/id6765577701';  // no country path: Apple geo-routes
const FORUM_URL = 'https://forum.dirtbikex.com';                  // guest browsing, no login wall
const REEL_URL = 'https://www.instagram.com/reel/DbP-9nTot-v/';
const LINK_STYLE = 'color:#0a58ca;';

// "DirtBikeX" and "iOS" are Latin literals in all 21 intros, but the word for "desktop" is
// translated (and inflected in fi/tr_TR), so it needs a per-locale map. Every entry below was
// verified to occur EXACTLY ONCE in that locale's intro, so each replacement is unambiguous.
const DESKTOP_WORD: Record<string, string> = {
  en: 'desktop', zh_CN: '桌面端', ja: 'デスクトップ', zh_TW: '桌面版', ko: '데스크톱',
  de: 'Desktop', it: 'desktop', fr: 'ordinateur', es: 'escritorio', ar: 'سطح المكتب',
  da: 'computer', el: 'υπολογιστή', sv: 'dator', th: 'เดสก์ท็อป', id: 'desktop',
  pt: 'desktop', fa_IR: 'دسکتاپ', fi: 'tietokoneelle', nl: 'desktop', tr_TR: 'masaüstünde',
  vi: 'máy tính',
};

/** Anchor an already-escaped intro. dir="ltr" keeps Latin URLs from being reordered inside the
 *  RTL (ar / fa_IR) blocks. Each literal occurs once, so `replace` with a string is exact. */
function linkIntroHtml(escapedIntro: string, locale: string): string {
  const a = (href: string, label: string) => `<a href="${href}" dir="ltr" style="${LINK_STYLE}">${label}</a>`;
  let out = escapedIntro.replace(BRAND, a(SITE_URL, SITE_LABEL));
  out = out.replace('iOS', a(APP_STORE_URL, 'iOS'));
  const word = DESKTOP_WORD[locale];
  if (word) out = out.replace(word, `<a href="${FORUM_URL}" style="${LINK_STYLE}">${word}</a>`);
  return out;
}

/** Plain-text form: only the brand becomes a bare URL. iOS/desktop stay as words — a text part
 *  stuffed with three raw URLs in one sentence is a spam pattern, and the links below cover it. */
function linkIntroText(intro: string): string {
  return intro.replace(BRAND, SITE_LABEL);
}

function stepsHtml(s: NonNullable<Block['steps']>, t: string): string {
  const off = (label: string) =>
    `<tr><td style="padding:1px 8px 1px 0;color:#999;">&#9675;</td><td style="color:#555;">${escapeHtml(label)}</td><td></td></tr>`;
  return `<p style="margin:18px 0 4px;">${fill(escapeHtml(s.title), t)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px;font-size:14px;line-height:1.6;">
<tr><td style="padding:1px 8px 1px 0;">&#9679;</td><td>${escapeHtml(s.got)}</td><td style="padding-left:10px;color:#ed6b00;white-space:nowrap;">&#8592; ${escapeHtml(s.here)}</td></tr>
${off(s.reply)}
${off(s.invite)}
${off(s.install)}
</table>`;
}

function stepsText(s: NonNullable<Block['steps']>, track: string): string {
  return `${fill(s.title, track)}\n  ● ${s.got}   <- ${s.here}\n  ○ ${s.reply}\n  ○ ${s.invite}\n  ○ ${s.install}`;
}

// The reel rides INSIDE the intro paragraph (the app is described there; "see it" belongs
// beside the description, not stranded above the CTA) — same words per locale, merged para.
function blockHtml(b: Block, track: string, locale: string): string {
  const t = escapeHtml(track);
  return `<p>${fill(escapeHtml(b.lead), t)}</p>
<p>${fill(linkIntroHtml(escapeHtml(b.intro), locale), t)} ${escapeHtml(b.look)} <a href="${REEL_URL}" dir="ltr" style="${LINK_STYLE}">instagram.com/reel/DbP-9nTot-v</a></p>
<p>${fill(escapeHtml(b.value), t)}</p>
${b.steps ? stepsHtml(b.steps, t) : ''}${b.early ? `<p>${fill(escapeHtml(b.early), t)}</p>\n` : ''}<p>${fill(escapeHtml(b.cta), t)}</p>
<p>${escapeHtml(SIGNATURE)}</p>`;
}

function blockText(b: Block, track: string): string {
  const steps = b.steps ? `${stepsText(b.steps, track)}\n\n` : '';
  const early = b.early ? `${fill(b.early, track)}\n\n` : '';
  return `${fill(b.lead, track)}\n\n${fill(linkIntroText(b.intro), track)} ${b.look} ${REEL_URL}\n\n${fill(b.value, track)}\n\n${steps}${early}${fill(b.cta, track)}\n\n${SIGNATURE}`;
}

const RTL_LOCALES = new Set(['ar', 'fa_IR']);

export function renderPreInvite(trackName: string, locale: string): { subject: string; html: string; text: string } {
  const local = locale && locale !== 'en' ? LOCALES[locale] : undefined;
  const subject = fill((local ?? EN).subject, trackName);
  // RTL locales get their block wrapped in dir="rtl" so Arabic/Persian render correctly;
  // the English block stacked below stays LTR.
  const localHtml = local
    ? (RTL_LOCALES.has(locale) ? `<div dir="rtl" style="text-align:right;">${blockHtml(local, trackName, locale)}</div>` : blockHtml(local, trackName, locale))
    : '';
  const htmlBlocks = local ? `${localHtml}\n<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">\n${blockHtml(EN, trackName, 'en')}` : blockHtml(EN, trackName, 'en');
  const textBlocks = local ? `${blockText(local, trackName)}\n\n—\n\n${blockText(EN, trackName)}` : blockText(EN, trackName);
  return { subject, html: htmlBlocks, text: textBlocks };
}

// ---- DM (pasted into IG/FB/X by the operator) -------------------------------
// Short, split into separate messages, and — unlike the reply-only email — it links the
// landing page (apex of MARKETING_BASE). English is the base + fallback until LOCALES_DM
// fills in; the operator copies each message between the ——— dividers as its own DM.
interface DmBlock { messages: string[] }

// DM copy leans on the medium: the sender profile (grid + reel) is one tap away, so
// msg 1 points there instead of describing the app; one link total, in msg 2 (links
// from unknown senders read as spam and get suppressed); the next step is channel-
// consistent — a DM funnel's invite arrives right here, not by email.
const EN_DM: DmBlock = {
  messages: [
    "Hi {track} team 👋 I'm Rubio — a rider who builds software for a living. I made DirtBikeX: an app just for dirt-bike & motocross people. Our profile here has a 30-second look.",
    "I'd like to give {track} a free page — you're on the riders' map, locals follow you, your events take RSVPs. I do the setup; if you're in, I'll send your personal invite right here. More at {landing}",
  ],
};

const LOCALES_DM: Record<string, DmBlock> = {
  zh_CN: { messages: [
    "{track} 团队，你们好 👋 我是 Rubio，一名也写代码的车手。我正在做 DirtBikeX，一个专为越野摩托和摩托越野人群打造的社区（iOS + 桌面端）。",
    "很想免费给 {track} 建个主页——车手能找到你、关注你的更新，零成本，我来帮你设置。来看看：{landing}",
  ] },
  ja: { messages: [
    "{track} チームのみなさま 👋 Rubio です。ソフトも書くライダーで、DirtBikeX を作っています。ダートバイクとモトクロスの人たちのためのコミュニティです（iOS + デスクトップ）。",
    "{track} の無料プロフィールをぜひ用意させてください。ライダーがあなたを見つけて更新をフォローできます。費用はかからず、設定はこちらで。ぜひご覧ください：{landing}",
  ] },
  zh_TW: { messages: [
    "{track} 團隊，您好 👋 我是 Rubio，一名也寫程式的車手。我正在做 DirtBikeX，一個專為越野摩托與越野賽車愛好者打造的社群（iOS + 桌面版）。",
    "很想免費為 {track} 建個主頁——車手能找到你、追蹤你的消息，零成本，我來幫你設定。來看看：{landing}",
  ] },
  ko: { messages: [
    "{track} 팀 여러분 👋 저는 Rubio예요. 소프트웨어도 만드는 라이더입니다. 더트바이크와 모토크로스인들을 위한 커뮤니티 DirtBikeX를 만들고 있어요 (iOS + 데스크톱).",
    "{track}에 무료 프로필을 만들어 드리고 싶어요—라이더들이 여러분을 찾고 소식을 팔로우할 수 있어요. 비용은 없고 설정은 제가 할게요. 한번 보세요: {landing}",
  ] },
  de: { messages: [
    "Hallo Team von {track} 👋 Ich bin Rubio, Fahrer und Softwareentwickler. Ich baue DirtBikeX, eine Community nur für Dirtbike- und Motocross-Leute (iOS + Desktop).",
    "Würde {track} gern ein kostenloses Profil geben – Fahrer finden dich und folgen deinen Updates, kostenlos, und ich richte alles ein. Schau mal: {landing}",
  ] },
  it: { messages: [
    "Ciao team di {track} 👋 Sono Rubio, rider e anche sviluppatore. Sto creando DirtBikeX, una community solo per gente di dirt bike e motocross (iOS + desktop).",
    "Mi piacerebbe dare a {track} un profilo gratuito – i rider ti trovano e seguono i tuoi aggiornamenti, a costo zero, e la configurazione la faccio io. Dai un'occhiata: {landing}",
  ] },
  fr: { messages: [
    "Bonjour l'équipe de {track} 👋 Je suis Rubio, pilote et aussi développeur. Je crée DirtBikeX, une communauté rien que pour les gens du dirt bike et du motocross (iOS + ordinateur).",
    "J'aimerais offrir à {track} un profil gratuit – les pilotes te trouvent et suivent tes actus, sans frais, et je m'occupe de l'installation. Jette un œil : {landing}",
  ] },
  es: { messages: [
    "Hola equipo de {track} 👋 Soy Rubio, piloto y también programador. Estoy creando DirtBikeX, una comunidad solo para gente del dirt bike y el motocross (iOS + escritorio).",
    "Me encantaría darle a {track} un perfil gratis: los pilotos te encuentran y siguen tus novedades, sin coste, y yo lo configuro. Échale un vistazo: {landing}",
  ] },
  ar: { messages: [
    "مرحبًا فريق {track} 👋 أنا Rubio، سائق وأيضًا مطوّر برمجيات. أصنع DirtBikeX، مجتمعًا مخصّصًا لعشّاق الدراجات الترابية والموتوكروس (iOS + سطح المكتب).",
    "يسعدني أن أمنح {track} ملفًا مجانيًا — يجدك السائقون ويتابعون جديدك، دون أي تكلفة، وأنا أتولّى الإعداد. ألقِ نظرة: {landing}",
  ] },
  da: { messages: [
    "Hej {track}-team 👋 Jeg er Rubio, kører og også udvikler. Jeg laver DirtBikeX, et fællesskab kun for dirtbike- og motocross-folk (iOS + computer).",
    "Vil meget gerne give {track} en gratis profil – kørere finder dig og følger dine opdateringer, gratis, og jeg sætter det op. Tag et kig: {landing}",
  ] },
  el: { messages: [
    "Γεια σας, ομάδα της {track} 👋 Είμαι ο Rubio, αναβάτης και προγραμματιστής. Φτιάχνω το DirtBikeX, μια κοινότητα μόνο για ανθρώπους του dirt bike και του motocross (iOS + υπολογιστής).",
    "Θα ήθελα πολύ να δώσω στην {track} ένα δωρεάν προφίλ — οι αναβάτες σε βρίσκουν και ακολουθούν τα νέα σου, χωρίς κόστος, και το στήνω εγώ. Ρίξε μια ματιά: {landing}",
  ] },
  sv: { messages: [
    "Hej {track}-teamet 👋 Jag är Rubio, förare och även utvecklare. Jag bygger DirtBikeX, en gemenskap bara för dirtbike- och motocrossfolk (iOS + dator).",
    "Skulle gärna ge {track} en gratis profil – förare hittar dig och följer dina uppdateringar, utan kostnad, och jag sätter upp det. Ta en titt: {landing}",
  ] },
  th: { messages: [
    "สวัสดีทีมงาน {track} 👋 ผมชื่อ Rubio เป็นนักขี่ที่เขียนซอฟต์แวร์ด้วย ผมกำลังทำ DirtBikeX คอมมูนิตี้เพื่อคนสายเดิร์ทไบก์และโมโตครอสโดยเฉพาะ (iOS + เดสก์ท็อป)",
    "อยากสร้างโปรไฟล์ฟรีให้ {track} มาก นักขี่จะเจอคุณและติดตามข่าวสารได้ ไม่มีค่าใช้จ่าย และผมตั้งค่าให้เอง ลองดูได้ที่: {landing}",
  ] },
  id: { messages: [
    "Halo tim {track} 👋 Saya Rubio, rider yang juga menulis perangkat lunak. Saya sedang membuat DirtBikeX, komunitas khusus untuk orang dirt bike dan motocross (iOS + desktop).",
    "Ingin sekali memberi {track} profil gratis — para rider menemukanmu dan mengikuti kabarmu, tanpa biaya, dan saya yang mengaturnya. Coba lihat: {landing}",
  ] },
  pt: { messages: [
    "Olá, equipe da {track} 👋 Sou o Rubio, piloto e também desenvolvedor. Estou criando o DirtBikeX, uma comunidade só para a galera do dirt bike e do motocross (iOS + desktop).",
    "Adoraria dar à {track} um perfil gratuito — os pilotos te encontram e seguem suas novidades, sem custo, e eu faço a configuração. Dá uma olhada: {landing}",
  ] },
  fa_IR: { messages: [
    "سلام تیم {track} 👋 من Rubio هستم، موتورسواری که برنامه هم می‌نویسد. دارم DirtBikeX را می‌سازم، جامعه‌ای فقط برای آدم‌های درت‌بایک و موتوکراس (iOS + دسکتاپ).",
    "خیلی دوست دارم برای {track} یک پروفایل رایگان بسازم — موتورسوارها پیدایت می‌کنند و به‌روزرسانی‌هایت را دنبال می‌کنند، بدون هزینه، و راه‌اندازی با من. یک نگاهی بینداز: {landing}",
  ] },
  fi: { messages: [
    "Hei {track}-tiimi 👋 Olen Rubio, kuljettaja ja myös kehittäjä. Rakennan DirtBikeX:ää, yhteisöä vain dirtbike- ja motocross-väelle (iOS + tietokone).",
    "Haluaisin antaa {track}:lle ilmaisen profiilin – kuljettajat löytävät sinut ja seuraavat päivityksiäsi, ilmaiseksi, ja minä hoidan käyttöönoton. Katsopa: {landing}",
  ] },
  nl: { messages: [
    "Hallo team van {track} 👋 Ik ben Rubio, rijder en ook ontwikkelaar. Ik maak DirtBikeX, een community alleen voor dirtbike- en motocrossmensen (iOS + desktop).",
    "Ik zou {track} graag een gratis profiel geven – rijders vinden je en volgen je updates, gratis, en ik zet het op. Neem een kijkje: {landing}",
  ] },
  tr_TR: { messages: [
    "Merhaba {track} ekibi 👋 Ben Rubio, hem sürücü hem yazılımcıyım. DirtBikeX'i yapıyorum, yalnızca dirt bike ve motokros insanları için bir topluluk (iOS + masaüstü).",
    "{track} için ücretsiz bir profil oluşturmayı çok isterim — sürücüler seni bulur ve güncellemelerini takip eder, ücretsiz, kurulumu da ben yaparım. Bir göz at: {landing}",
  ] },
  vi: { messages: [
    "Chào đội ngũ {track} 👋 Tôi là Rubio, một tay đua kiêm lập trình viên. Tôi đang làm DirtBikeX, một cộng đồng chỉ dành cho người chơi dirt bike và motocross (iOS + máy tính).",
    "Rất muốn tặng {track} một hồ sơ miễn phí — các tay đua tìm thấy bạn và theo dõi cập nhật của bạn, miễn phí, và tôi lo phần thiết lập. Ghé xem nhé: {landing}",
  ] },
};

// apex of the marketing base (drop scheme + www) -> the clean link pasted into a DM.
function marketingApex(base: string): string {
  const host = (base || 'https://www.dirtbikex.com').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  return `https://${host}`;
}

export function renderPreInviteDM(trackName: string, locale: string, marketingBase: string): { text: string } {
  const b = (locale && locale !== 'en' ? LOCALES_DM[locale] : undefined) ?? EN_DM;
  const landing = marketingApex(marketingBase);
  const text = b.messages
    .map((m) => m.replace(/\{track\}/g, trackName).replace(/\{landing\}/g, landing))
    .join('\n\n———\n\n');
  return { text };
}

// ---- sending ---------------------------------------------------------------

interface SendOpts {
  /** Logical recipient (the real operator) — drives the mailto unsubscribe context. */
  to: string;
  trackName: string;
  locale: string;
  /** Actual delivery address; defaults to `to`. Override mode redirects to your inbox. */
  deliverTo?: string;
  /** Subject prefix, e.g. `[TEST→operator@track.com] `. */
  subjectPrefix?: string;
  /** Tokened HTTPS one-click unsubscribe URL (real batch). Omit → mailto unsubscribe. */
  unsubUrl?: string;
  /** Resend Idempotency-Key — stable across retries of one attempt, unique per enqueue. */
  idempotencyKey?: string;
}

/**
 * How a failed send must be handled. The default is `defer`, NOT failure — because a real row
 * that reaches `failed_permanent` is unrecoverable: the partial unique index on
 * `outreach(email) WHERE mode='real'` (migrations/0007_outreach_pk.sql) plus handleBatch's
 * `ON CONFLICT … DO NOTHING` means a later batch reports it `already` forever, and the CRM has
 * already stamped the contact `contacted`. So only a fault in THIS row may be terminal.
 *   defer     — requeue, do NOT consume an attempt (rate limit, revoked key, paused account,
 *               unverified domain: all operator-fixable, none the row's fault)
 *   attempt   — requeue and consume one of MAX_ATTEMPTS. Only a SINGLE-send network throw, where
 *               the request may or may not have been delivered; bounded so it cannot spin, and
 *               safe to retry because the per-row Idempotency-Key dedupes it provider-side.
 *   permanent — terminal for this row only (400/422: bad address or payload)
 */
type FailMode = 'defer' | 'attempt' | 'permanent';
interface SendResult { ok: boolean; error?: string; fail?: FailMode; retryAfterSec?: number }

/** One Resend message payload — identical shape for the single and batch endpoints. */
interface ResendMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
}

/** Honour Resend's backoff hint so a 429 waits instead of hot-looping. Clamped to 15 min. */
function retryAfterSeconds(resp: Response): number | undefined {
  const raw = resp.headers.get('retry-after') ?? resp.headers.get('ratelimit-reset');
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 900) : undefined;
}

/**
 * Classify a non-2xx Resend response. Note what is NOT here: 401/403/404 fall through to
 * `defer`. A revoked API key or a paused account previously marked every claimed row
 * `failed_permanent` on the FIRST attempt — one account action could have silently burned the
 * entire remaining prospect list. Those rows now wait for the operator instead.
 */
function classifyResend(status: number, retryAfterSec?: number): SendResult {
  const error = `resend returned ${status}`;
  if (status === 400 || status === 422) return { ok: false, error, fail: 'permanent' };
  // Everything else — 429, 401/403 (revoked key, paused account), 404, 5xx — is a fault at the
  // provider or the account, never in this row, so it must not consume the row's retry budget.
  // Always back off: without one, a persistent 401 would re-claim and re-defer every 60s (the
  // same silent churn loop the cap exhaustion caused), and a 5xx would do it for 100 rows.
  return { ok: false, error, fail: 'defer', retryAfterSec: retryAfterSec ?? (status === 429 ? 60 : 300) };
}

/**
 * Build one Resend message. Shared by the single-send and batch paths so both emit
 * byte-identical mail — same footer, same List-Unsubscribe headers, same locale rendering.
 */
function buildPreInviteMessage(env: PagesEnv, from: string, o: SendOpts): ResendMessage {
  const replyTo = env.JOIN_REPLY_TO ?? '';
  const address = env.JOIN_ORG_ADDRESS ?? '';
  const deliverTo = o.deliverTo || o.to;
  const { subject: baseSubject, html: bodyHtml, text: bodyText } = renderPreInvite(o.trackName, o.locale);
  const subject = (o.subjectPrefix ?? '') + baseSubject;

  // CAN-SPAM: honest From, physical address, an unsubscribe. Real batch carries a tokened
  // HTTPS one-click (RFC 8058); the test/override path uses a mailto (RFC 2369) so a click
  // in a test email can't suppress a real operator.
  const unsubMailto = replyTo ? `mailto:${replyTo}?subject=unsubscribe` : '';
  const unsubLink = o.unsubUrl
    ? `<a href="${escapeHtml(o.unsubUrl)}" style="color:#767676;text-decoration:underline;">Unsubscribe</a>`
    : (replyTo ? `<a href="mailto:${escapeHtml(replyTo)}?subject=unsubscribe" style="color:#767676;text-decoration:underline;">Unsubscribe</a>` : '');
  // Socials were 12px grey inside the legal fine print — effectively invisible. They now get
  // their own line above the rule, at body size and in link blue, with a lead-in that gives a
  // reason to tap. Kept to text + one arrow: emoji and shout-caps in a footer read as spam.
  const socialHtml = SOCIALS.map(([n, u]) => `<a href="${u}" style="color:#0a58ca;font-weight:600;text-decoration:none;">${n}</a>`).join(' &nbsp;&middot;&nbsp; ');
  const footerHtml = `<p style="font-size:15px;line-height:1.5;margin:22px 0 0;">See riders and tracks already on it &rarr; ${socialHtml}</p>
<hr style="border:none;border-top:1px solid #ddd;margin:16px 0 12px;">
<p style="font-size:13px;color:#767676;line-height:1.5;">Advertisement. Your track is publicly listed, so you got this once.${address ? `<br>DirtBikeX &middot; ${escapeHtml(address)}` : ''}<br><a href="${SITE_URL}/privacy" style="color:#767676;text-decoration:underline;">Privacy</a> &middot; ${unsubLink}</p>`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;margin:0;padding:24px;">
<div style="max-width:600px;margin:0 auto;">
${bodyHtml}
${footerHtml}
</div>
</body></html>`;
  const unsubText = o.unsubUrl ? `\nUnsubscribe: ${o.unsubUrl}` : (replyTo ? `\nNot interested? Reply "unsubscribe" and we won't contact you again.` : '');
  const socialText = SOCIALS.map(([n, u]) => `${n}: ${u}`).join('\n');
  const text = `${bodyText}\n\nSee riders and tracks already on it:\n${socialText}\n\n—\nAdvertisement. Your track is publicly listed, so you got this once.\nDirtBikeX${address ? ` · ${address}` : ''}\nPrivacy: ${SITE_URL}/privacy${unsubText}`;

  // Email-level List-Unsubscribe headers. One-click POST only makes sense over HTTPS.
  const mailHeaders: Record<string, string> = {};
  if (o.unsubUrl) {
    mailHeaders['List-Unsubscribe'] = `<${o.unsubUrl}>`;
    mailHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  } else if (unsubMailto) {
    mailHeaders['List-Unsubscribe'] = `<${unsubMailto}>`;
  }

  return {
    from,
    to: [deliverTo],
    subject,
    html,
    text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(Object.keys(mailHeaders).length ? { headers: mailHeaders } : {}),
  };
}

/** Send ONE email via POST /emails. Used by /api/outreach/test and as the per-row fallback
 *  when a batch is rejected wholesale (see sendPreInviteBatch). */
async function sendPreInvite(env: PagesEnv, o: SendOpts): Promise<SendResult> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.JOIN_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, error: 'email misconfigured (RESEND_API_KEY / JOIN_FROM_EMAIL)', fail: 'defer' };
  const msg = buildPreInviteMessage(env, from, o);

  const httpHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (o.idempotencyKey) httpHeaders['Idempotency-Key'] = o.idempotencyKey;

  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: httpHeaders, body: JSON.stringify(msg),
      // Without a timeout a hung connection holds the cron invocation open across further
      // 60s triggers, letting ticks overlap and each re-budget from the same stale count.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error('outreach:resend_threw', { err: String(err) });
    return { ok: false, error: 'resend request failed', fail: 'attempt' };
  }
  if (!resp.ok) {
    console.error('outreach:resend_non_2xx', { status: resp.status });
    return classifyResend(resp.status, retryAfterSeconds(resp));
  }
  return { ok: true };
}

/**
 * Idempotency-Key for a batch request, derived from the sorted row ids in the chunk.
 *
 * SCOPE, honestly stated: this dedupes only a retry whose chunk contains the EXACT same id set.
 * It covers the common crash case — the tick dies after Resend accepted the batch but before D1
 * was written, and the next tick re-claims the same earliest-due rows. It does NOT cover a retry
 * whose membership shifted (a bounce/unsub webhook suppressed one of the rows, or newly-due rows
 * displaced some), which yields a different key and no provider-side dedupe. Chunking is over
 * id-sorted rows precisely to make membership as reproducible as possible.
 *
 * The residual risk is a duplicate cold email in that narrow window. The alternative — marking
 * rows sent BEFORE the response — would risk the strictly worse failure of never sending at all.
 */
async function batchIdempotencyKey(ids: number[]): Promise<string> {
  const canon = [...ids].sort((a, b) => a - b).join(',');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `drip-batch:${hex.slice(0, 48)}`;
}

/**
 * Send up to BATCH_CHUNK messages in ONE POST /emails/batch request. Each array entry is its
 * own separate message — recipients never see each other.
 *
 * Returns one SendResult per input item, index-aligned: Resend documents that `data[i]`
 * corresponds to the payload at the same index. An index with no id is DEFERRED, never marked
 * sent — we must never record a send we cannot prove happened.
 */
async function sendPreInviteBatch(env: PagesEnv, items: Array<{ id: number; opts: SendOpts }>): Promise<SendResult[]> {
  if (!items.length) return [];
  const apiKey = env.RESEND_API_KEY;
  const from = env.JOIN_FROM_EMAIL;
  if (!apiKey || !from) {
    return items.map(() => ({ ok: false, error: 'email misconfigured (RESEND_API_KEY / JOIN_FROM_EMAIL)', fail: 'defer' as FailMode }));
  }
  // A single row gains nothing from the batch endpoint's all-or-nothing validation.
  if (items.length === 1) return [await sendPreInvite(env, items[0].opts)];

  const payload = items.map((it) => buildPreInviteMessage(env, from, it.opts));
  const idempotencyKey = await batchIdempotencyKey(items.map((it) => it.id));

  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),   // bare top-level array, per the Resend batch API
      signal: AbortSignal.timeout(20_000),   // see the single-send path: prevents overlapping ticks
    });
  } catch (err) {
    // A whole-request failure says NOTHING about any individual row, so it must not consume 100
    // rows' attempts — five such faults would drive them all to unrecoverable failed_permanent.
    console.error('outreach:resend_batch_threw', { err: String(err), n: items.length });
    return items.map(() => ({ ok: false, error: 'resend batch request failed', fail: 'defer' as FailMode, retryAfterSec: 60 }));
  }

  if (!resp.ok) {
    console.error('outreach:resend_batch_non_2xx', { status: resp.status, n: items.length });
    // 400/422 means a payload/address was rejected, but the response does not say WHICH entry.
    // Re-send the chunk as singles so the offender is isolated and only IT can go terminal —
    // 99 good rows must never be lost for one bad address.
    if (resp.status === 400 || resp.status === 422) {
      console.warn('outreach:resend_batch_fallback_singles', { n: items.length });
      const results: SendResult[] = [];
      for (const it of items) results.push(await sendPreInvite(env, it.opts));
      return results;
    }
    const cls = classifyResend(resp.status, retryAfterSeconds(resp));
    return items.map(() => ({ ...cls }));
  }

  let data: Array<{ id?: string } | null> = [];
  try {
    const body = (await resp.json()) as { data?: Array<{ id?: string } | null> };
    data = Array.isArray(body?.data) ? body.data : [];
  } catch {
    // 2xx with an unreadable body: we cannot prove which rows were accepted. Defer them all
    // rather than mark an unsent row sent; the stable Idempotency-Key keeps the retry safe.
    console.error('outreach:resend_batch_unparsable', { n: items.length });
    return items.map(() => ({ ok: false, error: 'resend batch response unparsable', fail: 'defer' as FailMode }));
  }
  if (data.length !== items.length) console.error('outreach:resend_batch_length_mismatch', { got: data.length, want: items.length });

  return items.map((_, i) => (
    data[i]?.id ? { ok: true } : { ok: false, error: `resend batch: no id at index ${i}`, fail: 'defer' as FailMode }
  ));
}

// ---- auth + helpers --------------------------------------------------------

function checkAuth(request: Request, env: PagesEnv): boolean {
  const expected = env.OUTREACH_SECRET;
  if (!expected) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const got = header.slice('Bearer '.length).trim();
  if (got.length !== expected.length) return false;  // constant-time compare
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function normalizeEmail(raw: string): string | null {
  const e = (raw ?? '').trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** "1" on the prod worker only — the structural gate for real sends. */
function allowReal(env: PagesEnv): boolean {
  return env.OUTREACH_ALLOW_REAL === '1';
}

/**
 * Look up which of `emails` are suppressed, in chunks — D1 permits at most 100 bound
 * parameters per query, and both callers can exceed that (a job carries up to 1000 recipients;
 * a drip tick claims up to CLAIM_LIMIT).
 */
async function suppressedEmails(db: D1Database, emails: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < emails.length; i += 90) {
    const slice = emails.slice(i, i + 90);
    if (!slice.length) continue;
    const rows = (await db.prepare(
      `SELECT email FROM suppressions WHERE email IN (${slice.map(() => '?').join(',')})`
    ).bind(...slice).all<{ email: string }>()).results;
    for (const r of rows) found.add(r.email);
  }
  return found;
}

// ---- POST /api/outreach/test — bearer-authed single test send --------------

export async function handleOutreachTest(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  let body: { to?: string; trackName?: string; locale?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const to = (body.to ?? '').trim();
  const trackName = (body.trackName ?? '').trim() || 'your track';
  const locale = (body.locale ?? 'en').trim() || 'en';
  if (!EMAIL_RE.test(to)) return json({ error: 'invalid recipient email' }, 400);
  const result = await sendPreInvite(env, { to, trackName, locale });
  if (!result.ok) return json({ error: result.error ?? 'send failed' }, 502);
  return json({ ok: true, sent_to: to });
}

// ---- batch pipeline --------------------------------------------------------

type Mode = 'real' | 'dry_run' | 'override';
interface OutreachRow {
  id: number;
  email: string;
  mode: Mode;
  track_name: string;
  track_region: string | null;
  locale: string;
  job_id: string | null;
  override_to: string | null;
  unsub_token: string;
  attempts: number;
}

// POST /api/outreach/batch — enqueue a filtered batch (send-once) and return per-email
// disposition. `real` is prod-only; test modes (dry_run/override) are staging-only.
export async function handleBatch(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.SUBSCRIBERS_DB) return json({ error: 'outreach db not bound' }, 503);
  let body: { mode?: string; override_to?: string; recipients?: unknown; start_delay_min?: unknown; interval_min?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const mode: Mode = body.mode === 'override' ? 'override' : body.mode === 'dry_run' ? 'dry_run' : 'real';
  const overrideTo = normalizeEmail(body.override_to ?? '');
  const recipients = Array.isArray(body.recipients) ? (body.recipients as Array<Record<string, unknown>>) : [];
  // Per-batch pacing: first send after `start_delay_min`, then one every `interval_min`.
  // Stamped into each row's send_after; the drip only claims rows whose send_after has passed.
  const startDelayMin = Math.max(0, Math.min(1440, Number(body.start_delay_min) || 0));  // cap 24h
  const intervalMin = Math.max(0, Math.min(240, Number(body.interval_min) || 0));         // cap 4h/step
  const scheduled = startDelayMin > 0 || intervalMin > 0;
  const sendAfterAt = (slot: number): string | null =>
    scheduled ? new Date(Date.now() + (startDelayMin + slot * intervalMin) * 60000).toISOString().replace('T', ' ').slice(0, 19) : null;

  // Structural env gate: real → prod only; test modes → staging only.
  if (mode === 'real' && !allowReal(env)) return json({ error: 'real sends are prod-only on this worker' }, 403);
  if (mode !== 'real' && allowReal(env)) return json({ error: 'test modes run on staging, not the prod worker' }, 403);
  if (mode === 'override' && !overrideTo) return json({ error: 'override mode requires a valid override_to email' }, 400);
  if (!recipients.length) return json({ error: 'no recipients' }, 400);
  if (recipients.length > 1000) return json({ error: 'batch too large (max 1000 per job)' }, 400);

  const jobId = crypto.randomUUID();
  const dispositions: Record<string, string> = {};
  let enqueued = 0, already = 0, suppressed = 0, rejected = 0, duplicate = 0;

  // Normalize + dedup by email up front — bounds the DB work and stops duplicate
  // office-emails from double-counting the job.
  const byEmail = new Map<string, { email: string; trackName: string; region: string | null; locale: string }>();
  for (const r of recipients) {
    const email = normalizeEmail(String(r?.email ?? ''));
    if (!email) { if (r?.email) dispositions[String(r.email)] = 'rejected'; rejected++; continue; }
    if (byEmail.has(email)) { duplicate++; continue; }
    byEmail.set(email, {
      email,
      trackName: (String(r?.trackName ?? '').trim()) || 'your track',
      region: r?.trackRegion ? String(r.trackRegion) : null,
      locale: (String(r?.locale ?? 'en').trim()) || 'en',
    });
  }

  // ONE bulk suppression check instead of a query per recipient (subrequest budget), chunked
  // to stay inside D1's 100-bound-parameter ceiling.
  const suppressedSet = await suppressedEmails(env.SUBSCRIBERS_DB, [...byEmail.keys()]);

  let slot = 0;
  for (const rec of byEmail.values()) {
    if (suppressedSet.has(rec.email)) { dispositions[rec.email] = 'suppressed'; suppressed++; continue; }
    const unsub = crypto.randomUUID();
    const sendAfter = sendAfterAt(slot); slot++;
    if (mode === 'real') {
      // send-once (real): the partial unique index (email WHERE mode='real') makes a conflict
      // mean this operator is already ledgered — never re-mail.
      const row = await env.SUBSCRIBERS_DB.prepare(
        `INSERT INTO outreach (email,status,mode,track_name,track_region,locale,job_id,override_to,unsub_token,send_after)
         VALUES (?, 'queued', 'real', ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(email) WHERE mode='real' DO NOTHING RETURNING id`
      ).bind(rec.email, rec.trackName, rec.region, rec.locale, jobId, unsub, sendAfter).first();
      if (row) { dispositions[rec.email] = 'enqueued'; enqueued++; }
      else { dispositions[rec.email] = 'already'; already++; }
    } else {
      // test mode (override/dry_run): a PLAIN insert — each job gets its OWN rows, so two
      // concurrent override jobs to the same tracks no longer collide (the old email-upsert
      // reassigned the first job's rows to the second, orphaning the first).
      await env.SUBSCRIBERS_DB.prepare(
        `INSERT INTO outreach (email,status,mode,track_name,track_region,locale,job_id,override_to,unsub_token,send_after)
         VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(rec.email, mode, rec.trackName, rec.region, rec.locale, jobId, mode === 'override' ? overrideTo : null, unsub, sendAfter).run();
      dispositions[rec.email] = 'enqueued'; enqueued++;
    }
  }

  await env.SUBSCRIBERS_DB.prepare(
    `INSERT INTO outreach_jobs (id,mode,override_to,requested,enqueued,already,suppressed,rejected)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(jobId, mode, mode === 'override' ? overrideTo : null, recipients.length, enqueued, already, suppressed, rejected).run();

  return json({ ok: true, job_id: jobId, mode, counts: { requested: recipients.length, enqueued, already, suppressed, rejected, duplicate }, dispositions });
}

// GET /api/outreach/preview?trackName=&locale=&kind=email|dm — the Outreach tab's live
// preview. `dm` returns text-only (no subject/html); it's copied into a social DM, not sent.
export async function handlePreview(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const trackName = (url.searchParams.get('trackName') || 'your track').trim() || 'your track';
  const locale = (url.searchParams.get('locale') || 'en').trim() || 'en';
  const kind = (url.searchParams.get('kind') || 'email').trim();
  if (kind === 'dm') return json({ ok: true, ...renderPreInviteDM(trackName, locale, env.MARKETING_BASE ?? '') });
  return json({ ok: true, ...renderPreInvite(trackName, locale) });
}

// GET /api/outreach/status[?job_id=][&since=] — Send-jobs panel + `contacted` reconcile.
export async function handleStatus(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.SUBSCRIBERS_DB) return json({ error: 'outreach db not bound' }, 503);
  const url = new URL(request.url);
  const jobId = url.searchParams.get('job_id');
  if (jobId) {
    const job = await env.SUBSCRIBERS_DB.prepare('SELECT * FROM outreach_jobs WHERE id=?').bind(jobId).first();
    const rows = (await env.SUBSCRIBERS_DB.prepare(
      'SELECT email,status,mode,sent_at,last_error FROM outreach WHERE job_id=? ORDER BY email'
    ).bind(jobId).all()).results;
    const prog = (await env.SUBSCRIBERS_DB.prepare(
      'SELECT status, count(*) AS n FROM outreach WHERE job_id=? GROUP BY status'
    ).bind(jobId).all<{ status: string; n: number }>()).results;
    return json({ ok: true, job, rows, progress: Object.fromEntries(prog.map((p) => [p.status, p.n])) });
  }
  const jobs = (await env.SUBSCRIBERS_DB.prepare('SELECT * FROM outreach_jobs ORDER BY created_at DESC LIMIT 25').all()).results as Array<Record<string, unknown>>;
  // Attach live per-job progress from the ledger (sent / queued / …) so the CRM can show
  // whether a job's emails actually went out, not just that they were enqueued.
  const prog = (await env.SUBSCRIBERS_DB.prepare(
    'SELECT job_id, status, count(*) AS n FROM outreach GROUP BY job_id, status'
  ).all<{ job_id: string; status: string; n: number }>()).results;
  const byJob: Record<string, Record<string, number>> = {};
  for (const p of prog) { (byJob[p.job_id] ??= {})[p.status] = p.n; }
  // per-job ETA: how many are still pending + the last scheduled send_after (for a countdown).
  const etaRows = (await env.SUBSCRIBERS_DB.prepare(
    "SELECT job_id, count(*) AS pending, max(send_after) AS eta FROM outreach WHERE status IN ('queued','claimed') GROUP BY job_id"
  ).all<{ job_id: string; pending: number; eta: string | null }>()).results;
  const etaByJob: Record<string, { pending: number; eta: string | null }> = {};
  for (const e of etaRows) etaByJob[e.job_id] = { pending: e.pending, eta: e.eta };
  for (const j of jobs) {
    j.progress = byJob[String(j.id)] ?? {};
    j.eta = etaByJob[String(j.id)] ?? { pending: 0, eta: null };
  }
  // `?since=` returns real sends after that timestamp — the CRM polls this to reconcile `contacted`.
  const since = url.searchParams.get('since');
  const sent = since
    ? (await env.SUBSCRIBERS_DB.prepare(
        "SELECT email, sent_at FROM outreach WHERE mode='real' AND status='sent' AND sent_at > ? ORDER BY sent_at"
      ).bind(since).all<{ email: string; sent_at: string }>()).results
    : [];
  // Recent suppressions (bounces / complaints / unsubs) — the CRM surfaces these so a bounce
  // is visible, not just silently written to D1.
  const suppressions = (await env.SUBSCRIBERS_DB.prepare(
    'SELECT email, reason, source, created_at FROM suppressions ORDER BY created_at DESC LIMIT 50'
  ).all()).results;
  return json({ ok: true, jobs, sent, suppressions });
}

// GET /api/outreach/metrics — aggregate-only D1 counters for the Prometheus exporter. See DASHBOARDS_MODULE.md § DBX Outreach.
export async function handleMetrics(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.SUBSCRIBERS_DB) return json({ error: 'outreach db not bound' }, 503);
  const db = env.SUBSCRIBERS_DB;
  const cap = dailyCapOf(env);

  const one = async (sql: string, ...binds: unknown[]): Promise<number> =>
    ((await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n) ?? 0;

  const sendsRows = (await db.prepare('SELECT status, count(*) AS n FROM outreach GROUP BY status')
    .all<{ status: string; n: number }>()).results;
  const sends = Object.fromEntries(sendsRows.map((r) => [r.status, r.n]));

  const real_sent_total = await one("SELECT count(*) AS n FROM outreach WHERE mode='real' AND status='sent'");
  const real_sends_today = await one(
    "SELECT count(*) AS n FROM outreach WHERE mode='real' AND status='sent' AND sent_at >= datetime('now','start of day')"
  );
  const due_backlog = await one(
    "SELECT count(*) AS n FROM outreach WHERE status='queued' AND (send_after IS NULL OR send_after <= datetime('now'))"
  );
  const stuck_claimed = await one(
    "SELECT count(*) AS n FROM outreach WHERE status='claimed' AND claimed_at < datetime('now', ?)",
    `-${CLAIM_TTL_MIN} minutes`
  );

  const supRows = (await db.prepare('SELECT reason, count(*) AS n FROM suppressions GROUP BY reason')
    .all<{ reason: string; n: number }>()).results;
  const sup = Object.fromEntries(supRows.map((r) => [r.reason, r.n]));

  const y = (await db.prepare(
    'SELECT COALESCE(SUM(requested),0) AS requested, COALESCE(SUM(enqueued),0) AS enqueued, ' +
    'COALESCE(SUM(already),0) AS already, COALESCE(SUM(suppressed),0) AS suppressed, ' +
    'COALESCE(SUM(rejected),0) AS rejected FROM outreach_jobs'
  ).first<Record<string, number>>()) ?? { requested: 0, enqueued: 0, already: 0, suppressed: 0, rejected: 0 };

  // NULL (no real send ever) → null, so the exporter skips the series (no false stall pre-launch).
  const age = (await db.prepare(
    "SELECT strftime('%s','now') - strftime('%s', MAX(sent_at)) AS n FROM outreach WHERE mode='real' AND status='sent'"
  ).first<{ n: number | null }>())?.n ?? null;

  return json({
    ok: true,
    sends,
    real_sent_total,
    real_sends_today,
    daily_cap: cap,
    due_backlog,
    stuck_claimed,
    suppressions: { unsub: sup.unsub ?? 0, bounce: sup.bounce ?? 0, complaint: sup.complaint ?? 0, manual: sup.manual ?? 0 },
    batch_yield: { requested: y.requested, enqueued: y.enqueued, already: y.already, suppressed: y.suppressed, rejected: y.rejected },
    last_real_send_age_seconds: age,
  });
}

// GET|POST /api/outreach/u?token= — tokened unsubscribe. GET must NOT mutate: corporate
// link scanners / prefetchers (SafeLinks, Proofpoint, Gmail proxy) fire an unsolicited GET
// on every email link at delivery, which would silently suppress real operators. So GET
// renders a confirm form that POSTs; only POST (incl. RFC-8058 one-click) writes.
export async function handleUnsub(request: Request, env: PagesEnv): Promise<Response> {
  const html = (body: string, status: number) =>
    new Response(`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#222;">${body}</body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!env.SUBSCRIBERS_DB) return html('<p>Unavailable.</p>', 503);
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') ?? '').trim();
  if (!token) return html('<p>Missing token.</p>', 400);
  const row = await env.SUBSCRIBERS_DB.prepare('SELECT email FROM outreach WHERE unsub_token=?').bind(token).first<{ email: string }>();
  if (!row) return html('<p>This unsubscribe link is not valid.</p>', 404);

  if (request.method !== 'POST') {
    // Non-mutating: a human sees a button to confirm; a scanner's GET does nothing.
    const t = escapeHtml(token);
    return html(
      `<h2>Unsubscribe from DirtBikeX</h2><p>Click below to stop receiving emails at <strong>${escapeHtml(row.email)}</strong>.</p>`
      + `<form method="post" action="/api/outreach/u?token=${encodeURIComponent(t)}"><button type="submit" style="padding:.6rem 1.2rem;font-size:1rem;">Unsubscribe</button></form>`, 200);
  }
  await env.SUBSCRIBERS_DB.prepare(
    "INSERT INTO suppressions (email,reason,source) VALUES (?, 'unsub', 'one_click') ON CONFLICT(email) DO NOTHING"
  ).bind(row.email).run();
  await env.SUBSCRIBERS_DB.prepare(
    "UPDATE outreach SET status='suppressed' WHERE email=? AND status IN ('queued','claimed')"
  ).bind(row.email).run();
  return html("<h2>Unsubscribed</h2><p>You won't receive further emails from DirtBikeX. Sorry for the interruption.</p>", 200);
}

// ---- drip ------------------------------------------------------------------

// Rows per tick — this is the INSTANTANEOUS rate limiter, and it is deliberately one batch:
// 100 rows/tick = a single POST /emails/batch per minute = 100 emails/min, using ~0.02 of
// Resend's 10 req/s team limit. The daily cap bounds the DAY's volume; this bounds the burst.
// Both are needed: the cap alone let a spent budget re-open at 00:00 UTC and dump every
// already-due row at once (docs/OUTREACH_MODULE.md warns about exactly that reputation spike).
// Raise this only alongside a deliverability decision, in units of BATCH_CHUNK.
const CLAIM_LIMIT = 100;
const BATCH_CHUNK = 100;    // Resend's hard maximum per /emails/batch request
const CLAIM_TTL_MIN = 10;   // reaper re-queues claims older than this (a crashed mid-send)
const MAX_ATTEMPTS = 5;
const DEFAULT_DAILY_CAP = 200;

/** Effective daily cap on real sends. `0` is honoured as a deliberate HARD STOP — the previous
 *  `parseInt(…) || DEFAULT_DAILY_CAP` silently turned an operator's "0" pause into 200 sends.
 *  Absent or unparseable falls back to the default. */
function dailyCapOf(env: PagesEnv): number {
  const n = parseInt(env.OUTREACH_DAILY_CAP ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

interface DripResult {
  claimed: number; sent: number; dryrun: number; suppressed: number; failed: number;
  requeued: number;   // retried, consuming one of MAX_ATTEMPTS
  deferred: number;   // requeued WITHOUT consuming an attempt (cap, rate limit, account)
  cap: number; sentToday: number;
}

// One drip tick: reap stale claims → claim K queued → per row: suppression re-check, then
// send (real/override) or log (dry_run) with a Resend Idempotency-Key, mark terminal.
// Called by the Cron (scheduled) and by POST /api/outreach/drip. `dry` forces log-only.
export async function runDrip(env: PagesEnv, opts: { dry?: boolean } = {}): Promise<DripResult> {
  const out: DripResult = { claimed: 0, sent: 0, dryrun: 0, suppressed: 0, failed: 0, requeued: 0, deferred: 0, cap: 0, sentToday: 0 };
  const db = env.SUBSCRIBERS_DB;
  if (!db) return out;
  type Stmt = ReturnType<typeof db.prepare>;
  // A backoff may only ever DELAY a row — never pull it earlier. `max(send_after, now+backoff)`
  // matters because the backoff is now unconditional on any deferrable error: a plain
  // datetime('now','+300 seconds') would drag rows deliberately paced hours out (send_after
  // 17:00) forward onto one instant, and collapsing a whole tick's remainder onto a single
  // timestamp is exactly the reputation burst the per-row pacing exists to prevent.
  const requeue = (id: number, err?: string, backoffSec?: number): Stmt => (backoffSec
    ? db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL, send_after=max(coalesce(send_after, datetime('now')), datetime('now', ?)), last_error=? WHERE id=?").bind(`+${backoffSec} seconds`, err ?? null, id)
    : db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL, last_error=? WHERE id=?").bind(err ?? null, id));
  // Pre-flight: never CLAIM rows we can't send. A missing key would otherwise drop each
  // claimed real row to failed_permanent, and send-once blocks re-enqueue → permanent loss.
  if (!env.RESEND_API_KEY || !env.JOIN_FROM_EMAIL) { console.error('outreach:drip_misconfigured'); return out; }

  // reaper: rows stuck in 'claimed' past the TTL get re-queued (does NOT consume an attempt).
  await db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL WHERE status='claimed' AND claimed_at < datetime('now', ?)")
    .bind(`-${CLAIM_TTL_MIN} minutes`).run();

  const dailyCap = dailyCapOf(env);
  const sentToday = (await db.prepare(
    "SELECT count(*) AS n FROM outreach WHERE mode='real' AND status='sent' AND sent_at >= datetime('now','start of day')"
  ).first<{ n: number }>())?.n ?? 0;
  const realBudget = Math.max(0, dailyCap - sentToday);
  out.cap = dailyCap;
  out.sentToday = sentToday;

  // Never CLAIM more than we can send: clamp the claim to the remaining daily budget. Claiming
  // past it used to spin the drip into a silent no-op write loop — re-claiming and re-queueing
  // the same rows ~40 D1 row-writes/minute, sending nothing, for as long as the cap was spent.
  const claimN = allowReal(env) ? Math.min(CLAIM_LIMIT, realBudget) : CLAIM_LIMIT;
  if (claimN <= 0) {
    console.warn('outreach:drip_cap_exhausted', { cap: dailyCap, sent_today: sentToday });
    return out;
  }

  // claim via the subquery form (bare UPDATE…LIMIT isn't guaranteed in D1's SQLite build).
  // NB: attempts is NOT incremented here — only on a genuine transient failure (below). A
  // deferral or reaper re-queue must not consume the retry budget.
  const claimed = (await db.prepare(
    `UPDATE outreach SET status='claimed', claimed_at=datetime('now')
     WHERE rowid IN (SELECT rowid FROM outreach WHERE status='queued'
                     AND (send_after IS NULL OR send_after <= datetime('now'))
                     ORDER BY send_after, created_at LIMIT ?)
     RETURNING id, email, mode, track_name, track_region, locale, job_id, override_to, unsub_token, attempts`
  ).bind(claimN).all<OutreachRow>()).results;
  out.claimed = claimed.length;
  if (!claimed.length) return out;

  // ONE bulk suppression check for the whole tick (was a query per row — 100 at CLAIM_LIMIT=100).
  const suppressedSet = await suppressedEmails(db, [...new Set(claimed.map((r) => r.email))]);

  // Partition: rows that never reach Resend get their write queued here; the rest are sent.
  const pre: Stmt[] = [];
  const sendable: Array<{ id: number; attempts: number; opts: SendOpts }> = [];

  for (const row of claimed) {
    if (suppressedSet.has(row.email)) {
      pre.push(db.prepare("UPDATE outreach SET status='suppressed' WHERE id=?").bind(row.id));
      out.suppressed++;
      continue;
    }
    // Defense-in-depth: a real row must never send from a non-prod worker (belt to the
    // enqueue gate + the separate prod/preview D1s). Requeue without sending.
    if (row.mode === 'real' && !allowReal(env)) {
      pre.push(requeue(row.id, 'deferred: real row on a non-prod worker'));
      out.deferred++;
      continue;
    }
    // dry_run rows always log; opts.dry additionally logs test (override) rows. A real row
    // is NEVER treated as dry (that would mark it terminal without sending → permanent loss).
    const isDry = row.mode === 'dry_run' || (opts.dry && row.mode !== 'real');
    if (isDry) {
      console.log('outreach:drip_dryrun', { to: row.email, mode: row.mode, locale: row.locale });
      pre.push(db.prepare("UPDATE outreach SET status='sent_dryrun', sent_at=datetime('now'), last_error=NULL WHERE id=?").bind(row.id));
      out.dryrun++;
      continue;
    }

    const isOverride = row.mode === 'override';
    const deliverTo = isOverride ? (row.override_to || row.email) : row.email;
    // real → tokened HTTPS one-click; override/dry_run → mailto (so a test click can't
    // suppress a real operator whose token this row carries).
    const unsubUrl = row.mode === 'real' && env.MARKETING_BASE
      ? `${env.MARKETING_BASE}/api/outreach/u?token=${encodeURIComponent(row.unsub_token)}`
      : undefined;
    const subjectPrefix = isOverride ? `[TEST→${row.email}] ` : undefined;
    sendable.push({
      id: row.id,
      attempts: row.attempts,
      // Per-row Idempotency-Key, stable across every retry of this enqueue. Carried so the
      // single-send paths inside the batch flow (the 1-row shortcut and the 400/422 fallback)
      // keep provider-side dedupe — without it a re-claim after a crash re-mails the operator.
      opts: {
        to: row.email, trackName: row.track_name, locale: row.locale, deliverTo, subjectPrefix, unsubUrl,
        idempotencyKey: `${row.job_id ?? 'nojob'}:${row.email}`,
      },
    });
  }
  if (pre.length) await db.batch(pre);

  // Chunk over id-sorted rows: SQLite's RETURNING order is not specified, and a reproducible
  // chunk membership is what gives the batch Idempotency-Key a chance to match on a retry.
  sendable.sort((a, b) => a.id - b.id);

  // Send in chunks of BATCH_CHUNK (one HTTP request each) and write that chunk's outcome to D1
  // immediately after its response — keeping the window in which an accepted send is not yet
  // recorded as short as possible.
  for (let i = 0; i < sendable.length; i += BATCH_CHUNK) {
    const chunk = sendable.slice(i, i + BATCH_CHUNK);
    const results = await sendPreInviteBatch(env, chunk.map((c) => ({ id: c.id, opts: c.opts })));

    const writes: Stmt[] = [];
    const acceptedEmails: string[] = [];
    let backoffSec: number | undefined;
    for (let k = 0; k < chunk.length; k++) {
      const { id, attempts } = chunk[k];
      const res: SendResult = results[k] ?? { ok: false, error: 'no batch result for row', fail: 'defer' };
      if (res.ok) {
        writes.push(db.prepare("UPDATE outreach SET status='sent', sent_at=datetime('now'), last_error=NULL WHERE id=?").bind(id));
        acceptedEmails.push(chunk[k].opts.to);
        out.sent++;
      } else if (res.fail === 'permanent') {
        writes.push(db.prepare("UPDATE outreach SET status='failed_permanent', last_error=? WHERE id=?").bind(res.error ?? 'failed', id));
        out.failed++;
      } else if (res.fail === 'attempt') {
        // consume ONE retry attempt here (the only place attempts rises).
        if (attempts < MAX_ATTEMPTS) {
          writes.push(db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL, attempts=attempts+1, last_error=? WHERE id=?").bind(res.error ?? 'transient', id));
          out.requeued++;
        } else {
          writes.push(db.prepare("UPDATE outreach SET status='failed_permanent', last_error=? WHERE id=?").bind(res.error ?? 'failed', id));
          out.failed++;
        }
      } else {
        writes.push(requeue(id, res.error ?? 'deferred', res.retryAfterSec));
        if (res.retryAfterSec) backoffSec = Math.max(backoffSec ?? 0, res.retryAfterSec);
        out.deferred++;
      }
    }
    // db.batch is atomic: if it throws, NONE of the rows are recorded while the mail is already
    // accepted by Resend. Log exactly which addresses were accepted so the send is recoverable
    // from the log rather than lost, then rethrow (the rows stay `claimed` for the reaper).
    try {
      await db.batch(writes);
    } catch (err) {
      console.error('outreach:drip_write_failed_after_send', {
        err: String(err), accepted: acceptedEmails, chunk_ids: chunk.map((c) => c.id),
      });
      throw err;
    }

    // Rate-limited or account-blocked: stop the tick instead of hammering Resend with the
    // remaining chunks. Requeue the untouched remainder so nothing sits `claimed` for the
    // reaper's 10 minutes.
    if (backoffSec) {
      const rest = sendable.slice(i + BATCH_CHUNK);
      if (rest.length) {
        await db.batch(rest.map((r) => requeue(r.id, 'deferred: tick backed off', backoffSec)));
        out.deferred += rest.length;
      }
      console.warn('outreach:drip_backoff', { retry_after_sec: backoffSec, deferred: out.deferred });
      break;
    }
  }
  return out;
}

// POST /api/outreach/drip[?dry=1] — run one drip tick on demand (bearer).
export async function handleDrip(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  // Refuse forced-dry on the prod worker: it holds only real rows, and marking them
  // sent_dryrun would consume them terminally (send-once → never sent).
  if (dry && allowReal(env)) return json({ error: 'dry-run drip is staging-only' }, 403);
  const result = await runDrip(env, { dry });
  return json({ ok: true, dry, ...result });
}

// ---- Resend bounce/complaint webhook -> suppressions --------------------------

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify a Resend/Svix webhook: signature = base64(HMAC-SHA256(secretBytes, `${id}.${ts}.${body}`)),
// matched against any `v1,<sig>` entry in the svix-signature header. secret is `whsec_<base64>`.
async function verifySvix(secret: string, id: string, timestamp: string, body: string, sigHeader: string): Promise<boolean> {
  try {
    const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    for (const part of sigHeader.split(' ')) {
      const sig = part.split(',')[1];
      if (sig && timingSafeEqualStr(sig, expected)) return true;
    }
  } catch (err) {
    console.error('outreach:webhook_verify_threw', { err: String(err) });
  }
  return false;
}

// POST /api/outreach/webhook — Resend bounce/complaint events. Signature-verified (public,
// mutating). Hard bounces + complaints suppress the address in D1 and cancel any still-pending
// row; other events are acked and ignored. See docs/OUTREACH_MODULE.md §"Batch outreach".
export async function handleWebhook(request: Request, env: PagesEnv): Promise<Response> {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'webhook not configured' }, 503);
  const id = request.headers.get('svix-id') ?? '';
  const timestamp = request.headers.get('svix-timestamp') ?? '';
  const sigHeader = request.headers.get('svix-signature') ?? '';
  const body = await request.text();
  if (!id || !timestamp || !sigHeader) return json({ error: 'missing signature headers' }, 400);
  const tsNum = parseInt(timestamp, 10);
  if (!tsNum || Math.abs(Date.now() / 1000 - tsNum) > 300) return json({ error: 'stale timestamp' }, 400);  // replay guard
  if (!(await verifySvix(secret, id, timestamp, body, sigHeader))) return json({ error: 'bad signature' }, 401);

  let evt: { type?: string; data?: { to?: string[] | string; email?: string; bounce?: { type?: string } } };
  try { evt = JSON.parse(body); } catch { return json({ error: 'invalid json' }, 400); }
  const type = evt.type ?? '';
  const isComplaint = type === 'email.complained';
  const bounceType = String(evt.data?.bounce?.type ?? '').toLowerCase();
  // Suppress on complaints and on HARD bounces only — a soft/transient bounce is retryable.
  const isHardBounce = type === 'email.bounced' && !bounceType.includes('transient') && !bounceType.includes('soft');
  if (!isComplaint && !isHardBounce) return json({ ok: true, ignored: type || 'unknown' });

  if (!env.SUBSCRIBERS_DB) return json({ ok: true, note: 'no db bound' });
  const to = evt.data?.to;
  const recips = Array.isArray(to) ? to : to ? [to] : evt.data?.email ? [evt.data.email] : [];
  const reason = isComplaint ? 'complaint' : 'bounce';
  let n = 0;
  for (const r of recips) {
    const email = normalizeEmail(String(r));
    if (!email) continue;
    await env.SUBSCRIBERS_DB.prepare(
      "INSERT INTO suppressions (email,reason,source) VALUES (?, ?, 'resend_webhook') ON CONFLICT(email) DO NOTHING"
    ).bind(email, reason).run();
    // cancel any still-pending send to a now-dead address (send 'sent' rows stay as history).
    await env.SUBSCRIBERS_DB.prepare(
      "UPDATE outreach SET status='suppressed' WHERE email=? AND status IN ('queued','claimed')"
    ).bind(email).run();
    n++;
  }
  return json({ ok: true, type, reason, suppressed: n });
}
