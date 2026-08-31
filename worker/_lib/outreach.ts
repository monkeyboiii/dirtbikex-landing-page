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
    value: "我想在里面免费给 {track} 建一个主页。你现有的渠道触达的是已经认识你的车手——而这个是给还不认识你的人准备的：在地图上找场地的车手、路过的车手、刚入坑的新人。一份全球车场目录，{track} 就在上面。",
    cta: "有兴趣的话，回复即可。",
    look: "花 30 秒看一下：",
    steps: { title: "让 {track} 上线 DirtBikeX，只需四小步：", got: "你收到了这封邮件", reply: "你回复确认", invite: "我发给你专属邀请", install: "你安装 App——主页即刻上线", here: "你在这里" },
    early: "我们还处于早期——最早加入的场地会影响产品的方向，早期支持者也会随着 DirtBikeX 成长获得回报。",
  },
  ja: {
    subject: "{track} のようなコースのためだけに作ったコミュニティ",
    lead: "{track} チームのみなさま、",
    intro: "はじめまして、Rubio と申します。普段はソフトウェアを書いて生計を立てているライダーで、DirtBikeX を作っています。ダートバイクとモトクロスに関わる人たちのためだけのコミュニティです。今は iOS とデスクトップで使えます。管理が増えるだけの新しいフィードではなく、ノイズのない、フォーラム中心の集中できる場所で、そこにいる誰もが走るために来ています。",
    value: "その中で {track} の無料ページをご用意したいと思っています。既存のチャネルが届くのは、すでにあなたを知っているライダーです。これは、まだ知らない人たちのためのもの——地図で走る場所を探すライダー、旅の途中のライダー、始めたばかりの人。世界規模のコース一覧に、{track} が載ります。",
    cta: "ご興味があれば、返信だけで大丈夫です。",
    look: "30 秒の紹介はこちら：",
    steps: { title: "{track} を DirtBikeX に載せるまで、4 つの小さなステップ：", got: "このメールが届いた", reply: "返信して承諾", invite: "専用の招待をお送りします", install: "アプリを入れれば、ページが公開されます", here: "いまここ" },
    early: "私たちはまだ立ち上げ期です。最初に参加してくれたコースが作るものを方向づけ、早くから支えてくれた方には DirtBikeX の成長とともに還元していきます。",
  },
  zh_TW: {
    subject: "專為像 {track} 這樣的場地打造的社群",
    lead: "{track} 團隊，您好：",
    intro: "我是 Rubio——一名平時靠寫程式維生的車手，正在打造 DirtBikeX：一個專為越野摩托與越野賽車愛好者而生的社群。現已支援 iOS 與桌面版——它不是又一個要你打理的動態牆，而是一個專注、以論壇為核心、沒有雜訊的地方，來這裡的每個人都是為了騎乘。",
    value: "我想在裡面免費為 {track} 建立一個主頁。你現有的管道觸及的是已經認識你的車手——而這個是給還不認識你的人：在地圖上找場地的車手、路過的車手、剛入門的新手。一份全球車場目錄，{track} 就在上面。",
    cta: "有興趣的話，回覆即可。",
    look: "花 30 秒看一下：",
    steps: { title: "讓 {track} 上線 DirtBikeX，只需四小步：", got: "你收到了這封信", reply: "你回覆同意", invite: "我寄給你專屬邀請", install: "你安裝 App——主頁隨即上線", here: "你在這裡" },
    early: "我們還在早期階段——最早加入的場地會影響產品的方向，早期支持者也會隨著 DirtBikeX 成長獲得回報。",
  },
  ko: {
    subject: "{track} 같은 트랙만을 위한 커뮤니티",
    lead: "{track} 팀 여러분, 안녕하세요.",
    intro: "저는 Rubio입니다. 소프트웨어를 만들며 먹고사는 라이더이고, DirtBikeX를 만들고 있어요. 더트바이크와 모토크로스에 관련된 사람들만을 위한 커뮤니티입니다. 지금은 iOS와 데스크톱에서 사용할 수 있어요. 또 하나 관리해야 할 피드가 아니라, 소음 없이 포럼 중심으로 집중된 공간이고, 여기 있는 모두가 오직 라이딩을 위해 모입니다.",
    value: "그 안에 {track}의 무료 페이지를 만들어 드리고 싶어요. 지금 쓰시는 채널은 이미 여러분을 아는 라이더에게 닿습니다. 이건 아직 모르는 사람들을 위한 거예요 — 지도에서 탈 곳을 찾는 라이더, 지나가는 라이더, 이제 막 시작한 사람들. 전 세계 트랙 카탈로그에 {track}이 실립니다.",
    cta: "관심 있으시면 답장만 주세요.",
    look: "30초짜리 영상으로 보기:",
    steps: { title: "{track}을 DirtBikeX에 올리는 작은 4단계:", got: "이 메일을 받았어요", reply: "답장으로 동의", invite: "개인 초대장을 보내드려요", install: "앱을 설치하면 페이지가 열립니다", here: "지금 여기" },
    early: "저희는 아직 초기 단계예요 — 먼저 합류한 트랙이 만들어질 것들을 결정하고, 초기 서포터에게는 DirtBikeX가 성장하며 보답할 거예요.",
  },
  de: {
    subject: "Eine Community, gemacht für Strecken wie {track}",
    lead: "Hallo Team von {track},",
    intro: "Ich bin Rubio – Fahrer und hauptberuflich Softwareentwickler – und ich baue DirtBikeX: eine Community speziell für Dirtbike- und Motocross-Leute. Ab sofort für iOS und Desktop verfügbar – kein weiterer Feed, den du pflegen musst, sondern ein fokussierter, forumbasierter Ort ohne Rauschen, an dem alle nur zum Fahren da sind.",
    value: "Ich würde {track} dort gern eine kostenlose Seite einrichten. Deine eigenen Kanäle erreichen die Fahrer, die dich schon kennen — das hier ist für die, die dich noch nicht kennen: Fahrer, die auf der Karte nach einer Strecke suchen, auf der Durchreise sind oder gerade erst anfangen. Ein weltweiter Streckenkatalog, und {track} steht drin.",
    cta: "Wenn du dabei bist, antworte einfach.",
    look: "Hier ein 30-Sekunden-Einblick:",
    steps: { title: "{track} auf DirtBikeX — vier kleine Schritte:", got: "Du hast diese Mail bekommen", reply: "Du antwortest und sagst zu", invite: "Ich schicke dir deine persönliche Einladung", install: "Du installierst die App — deine Seite ist live", here: "du bist hier" },
    early: "Wir sind noch früh dran — die ersten Strecken prägen, was gebaut wird, und früher Support zahlt sich aus, wenn DirtBikeX wächst.",
  },
  it: {
    subject: "Una community fatta apposta per piste come {track}",
    lead: "Ciao team di {track},",
    intro: "Sono Rubio – rider e sviluppatore software di professione – e sto costruendo DirtBikeX: una community pensata solo per chi vive il mondo delle dirt bike e del motocross. Ora disponibile su iOS e desktop – non un altro feed da gestire, ma un posto concentrato, basato su forum e senza rumore, dove chi c'è è lì solo per andare in moto.",
    value: "Mi piacerebbe creare lì una pagina gratuita per {track}. I tuoi canali raggiungono già chi ti conosce — questa è per chi ancora non ti conosce: rider che cercano una pista sulla mappa, di passaggio, o alle prime armi. Un catalogo mondiale delle piste, con {track} dentro.",
    cta: "Se ci stai, rispondi pure.",
    look: "Ecco uno sguardo di 30 secondi:",
    steps: { title: "Portare {track} su DirtBikeX — quattro piccoli passi:", got: "Hai ricevuto questa email", reply: "Rispondi per accettare", invite: "Ti mando l'invito personale", install: "Installi l'app — la tua pagina è online", here: "sei qui" },
    early: "Siamo agli inizi — le prime piste a bordo danno forma a ciò che costruiamo, e chi ci supporta presto verrà ripagato con la crescita di DirtBikeX.",
  },
  fr: {
    subject: "Une communauté faite pour des pistes comme {track}",
    lead: "Bonjour l'équipe de {track},",
    intro: "Je suis Rubio – pilote et développeur de logiciels au quotidien – et je construis DirtBikeX : une communauté pensée uniquement pour les passionnés de dirt bike et de motocross. Disponible dès maintenant sur iOS et ordinateur – pas un énième fil à gérer, mais un endroit ciblé, basé sur un forum et sans bruit, où tout le monde est là pour rouler.",
    value: "J'aimerais y créer une page gratuite pour {track}. Tes canaux actuels touchent les pilotes qui te connaissent déjà — ceci s'adresse à ceux qui ne te connaissent pas encore : des pilotes qui cherchent une piste sur la carte, de passage, ou qui débutent. Un catalogue mondial des pistes, avec {track} dedans.",
    cta: "Si ça te dit, réponds simplement.",
    look: "Un aperçu en 30 secondes :",
    steps: { title: "Mettre {track} sur DirtBikeX — quatre petites étapes :", got: "Tu as reçu ce message", reply: "Tu réponds pour accepter", invite: "Je t'envoie ton invitation personnelle", install: "Tu installes l'appli — ta page est en ligne", here: "tu es ici" },
    early: "On n'en est qu'au début — les premières pistes à bord façonnent ce qu'on construit, et les soutiens de la première heure seront récompensés à mesure que DirtBikeX grandit.",
  },
  es: {
    subject: "Una comunidad hecha para pistas como {track}",
    lead: "Hola equipo de {track},",
    intro: "Soy Rubio, piloto y programador de profesión, y estoy creando DirtBikeX: una comunidad pensada solo para la gente del dirt bike y el motocross. Ya disponible en iOS y escritorio; no es otro feed más que gestionar, sino un lugar centrado, basado en foro y sin ruido, donde todos están para rodar.",
    value: "Me gustaría crear ahí una página gratis para {track}. Tus canales ya llegan a los pilotos que te conocen — esto es para los que aún no: pilotos que buscan pista en el mapa, que están de paso o que acaban de empezar. Un catálogo mundial de pistas, con {track} dentro.",
    cta: "Si te apuntas, solo responde.",
    look: "Aquí tienes un vistazo de 30 segundos:",
    steps: { title: "Llevar {track} a DirtBikeX — cuatro pasos sencillos:", got: "Recibiste este correo", reply: "Respondes para aceptar", invite: "Te envío tu invitación personal", install: "Instalas la app — tu página queda publicada", here: "estás aquí" },
    early: "Estamos empezando — las primeras pistas a bordo marcan lo que construimos, y a los que apoyan desde el principio se les recompensará a medida que DirtBikeX crezca.",
  },
  ar: {
    subject: "مجتمع مصنوع خصيصًا لحلبات مثل {track}",
    lead: "مرحبًا فريق {track}،",
    intro: "أنا Rubio، سائق أعمل في تطوير البرمجيات، وأبني DirtBikeX: مجتمع مخصّص لعشّاق الدراجات الترابية والموتوكروس. متاح الآن على iOS وسطح المكتب — ليس مجرد موجز آخر عليك إدارته، بل مكان مركّز قائم على المنتدى وبلا ضجيج، كل من فيه موجود ليقود فقط.",
    value: "أودّ أن أنشئ لـ {track} صفحة مجانية هناك. قنواتك الحالية تصل إلى السائقين الذين يعرفونك بالفعل — أما هذه فلمن لا يعرفك بعد: سائقون يبحثون في الخريطة عن مكان للقيادة، أو عابرون، أو جدد على الرياضة. دليل عالمي واحد للحلبات، و{track} مدرجة فيه.",
    cta: "إن كنت موافقًا، فقط ردّ على هذه الرسالة.",
    look: "إليك لمحة في 30 ثانية:",
    steps: { title: "إدراج {track} في DirtBikeX — أربع خطوات صغيرة:", got: "وصلتك هذه الرسالة", reply: "تردّ بالموافقة", invite: "أرسل لك دعوتك الشخصية", install: "تثبّت التطبيق — وتصبح صفحتك جاهزة", here: "أنت هنا" },
    early: "ما زلنا في البداية — الحلبات الأولى تشكّل ما نبنيه، وسيُكافأ الداعمون الأوائل مع نموّ DirtBikeX.",
  },
  da: {
    subject: "Et fællesskab skabt til baner som {track}",
    lead: "Hej {track}-team,",
    intro: "Jeg er Rubio – kører og softwareudvikler til daglig – og jeg bygger DirtBikeX: et fællesskab lavet specifikt til dirtbike- og motocross-folk. Nu tilgængeligt på iOS og computer – ikke endnu et feed, du skal passe, men et fokuseret, forumbaseret sted uden støj, hvor alle er der for at køre.",
    value: "Jeg vil gerne oprette en gratis side til {track} derinde. Dine egne kanaler når de kørere, der allerede kender dig — det her er til dem, der ikke gør endnu: kørere, der leder efter en bane på kortet, er på gennemrejse eller lige er startet. Ét globalt banekatalog, og {track} står i det.",
    cta: "Er du med, så svar bare.",
    look: "Her er et kig på 30 sekunder:",
    steps: { title: "{track} på DirtBikeX — fire små trin:", got: "Du fik denne mail", reply: "Du svarer og siger ja", invite: "Jeg sender din personlige invitation", install: "Du installerer appen — din side er live", here: "du er her" },
    early: "Vi er stadig tidligt ude — de første baner er med til at forme det, vi bygger, og tidlig støtte bliver belønnet, i takt med at DirtBikeX vokser.",
  },
  el: {
    subject: "Μια κοινότητα φτιαγμένη για πίστες σαν την {track}",
    lead: "Γεια σας, ομάδα της {track},",
    intro: "Είμαι ο Rubio — αναβάτης και επαγγελματίας προγραμματιστής — και φτιάχνω το DirtBikeX: μια κοινότητα φτιαγμένη αποκλειστικά για τους ανθρώπους του dirt bike και του motocross. Διαθέσιμο τώρα σε iOS και υπολογιστή — όχι άλλο ένα feed για να διαχειρίζεσαι, αλλά ένας εστιασμένος χώρος βασισμένος σε φόρουμ, χωρίς θόρυβο, όπου όλοι είναι εκεί μόνο για να καβαλήσουν.",
    value: "Θα ήθελα να φτιάξω εκεί μια δωρεάν σελίδα για την {track}. Τα κανάλια σου φτάνουν ήδη στους αναβάτες που σε ξέρουν — αυτό είναι για όσους δεν σε ξέρουν ακόμα: αναβάτες που ψάχνουν πίστα στον χάρτη, περαστικοί, ή νέοι στο άθλημα. Ένας παγκόσμιος κατάλογος πιστών, με την {track} μέσα.",
    cta: "Αν είσαι μέσα, απλώς απάντησε.",
    look: "Δείτε το σε 30 δευτερόλεπτα:",
    steps: { title: "Η {track} στο DirtBikeX — τέσσερα μικρά βήματα:", got: "Έλαβες αυτό το email", reply: "Απαντάς και συμφωνείς", invite: "Σου στέλνω την προσωπική σου πρόσκληση", install: "Εγκαθιστάς την εφαρμογή — η σελίδα σου είναι έτοιμη", here: "είσαι εδώ" },
    early: "Είμαστε ακόμα στην αρχή — οι πρώτες πίστες διαμορφώνουν αυτό που χτίζεται, και οι πρώτοι υποστηρικτές θα ανταμειφθούν όσο μεγαλώνει το DirtBikeX.",
  },
  sv: {
    subject: "En gemenskap gjord för banor som {track}",
    lead: "Hej {track}-teamet,",
    intro: "Jag heter Rubio – förare och mjukvaruutvecklare till vardags – och jag bygger DirtBikeX: en gemenskap gjord specifikt för dirtbike- och motocrossfolk. Nu tillgänglig för iOS och dator – inte ännu ett flöde att sköta, utan en fokuserad, forumbaserad plats utan brus, där alla är där för att köra.",
    value: "Jag vill gärna skapa en gratis sida för {track} där. Dina egna kanaler når förarna som redan känner dig — det här är för dem som inte gör det än: förare som letar bana på kartan, är på genomresa eller precis har börjat. En global bankatalog, och {track} finns med.",
    cta: "Är du med, svara bara.",
    look: "Här är en titt på 30 sekunder:",
    steps: { title: "{track} på DirtBikeX — fyra små steg:", got: "Du fick det här mejlet", reply: "Du svarar och tackar ja", invite: "Jag skickar din personliga inbjudan", install: "Du installerar appen — din sida är live", here: "du är här" },
    early: "Vi är fortfarande tidiga — de första banorna formar det som byggs, och tidigt stöd belönas i takt med att DirtBikeX växer.",
  },
  th: {
    subject: "คอมมูนิตี้ที่สร้างมาเพื่อสนามอย่าง {track} โดยเฉพาะ",
    lead: "สวัสดีทีมงาน {track}",
    intro: "ผมชื่อ Rubio เป็นนักขี่ที่ทำงานเขียนซอฟต์แวร์เป็นอาชีพ และกำลังสร้าง DirtBikeX คอมมูนิตี้ที่ทำมาเพื่อคนสายเดิร์ทไบก์และโมโตครอสโดยเฉพาะ ตอนนี้ใช้ได้ทั้งบน iOS และเดสก์ท็อป ไม่ใช่ฟีดอีกอันที่คุณต้องคอยดูแล แต่เป็นพื้นที่ที่โฟกัส เน้นฟอรัม ไม่มีสิ่งรบกวน และทุกคนที่นี่มาเพื่อขี่จริง ๆ",
    value: "ผมอยากสร้างเพจฟรีให้ {track} ในนั้น ช่องทางที่คุณมีอยู่เข้าถึงนักขี่ที่รู้จักคุณอยู่แล้ว — อันนี้สำหรับคนที่ยังไม่รู้จักคุณ: นักขี่ที่หาสนามจากแผนที่ ผ่านมาเที่ยว หรือเพิ่งเริ่มเล่น แคตตาล็อกสนามระดับโลกหนึ่งเดียว และ {track} อยู่ในนั้น",
    cta: "ถ้าสนใจ ตอบกลับได้เลย",
    look: "ดูคลิป 30 วินาทีได้ที่นี่:",
    steps: { title: "พา {track} ขึ้น DirtBikeX — สี่ขั้นตอนง่าย ๆ:", got: "คุณได้รับอีเมลนี้", reply: "คุณตอบกลับเพื่อตกลง", invite: "ผมส่งคำเชิญส่วนตัวให้", install: "คุณติดตั้งแอป — เพจของคุณออนไลน์ทันที", here: "คุณอยู่ตรงนี้" },
    early: "เรายังอยู่ในช่วงเริ่มต้น — สนามกลุ่มแรกจะช่วยกำหนดทิศทางของแพลตฟอร์ม และผู้สนับสนุนยุคแรกจะได้รับผลตอบแทนเมื่อ DirtBikeX เติบโต",
  },
  id: {
    subject: "Komunitas yang dibuat khusus untuk trek seperti {track}",
    lead: "Halo tim {track},",
    intro: "Saya Rubio — seorang rider yang sehari-hari menulis perangkat lunak — dan saya membangun DirtBikeX: komunitas yang dibuat khusus untuk orang-orang dirt bike dan motocross. Sekarang tersedia di iOS dan desktop — bukan satu feed lagi yang harus kamu urus, tapi tempat yang fokus, berbasis forum, tanpa gangguan, di mana semua yang ada di sana hadir untuk riding.",
    value: "Saya ingin membuatkan {track} halaman gratis di sana. Kanal yang kamu punya sudah menjangkau rider yang mengenalmu — yang ini untuk mereka yang belum: rider yang mencari trek di peta, yang sedang lewat, atau yang baru mulai. Satu katalog trek global, dan {track} ada di dalamnya.",
    cta: "Kalau mau, cukup balas email ini.",
    look: "Ini cuplikan 30 detik:",
    steps: { title: "Membawa {track} ke DirtBikeX — empat langkah kecil:", got: "Kamu menerima email ini", reply: "Kamu balas untuk setuju", invite: "Saya kirim undangan pribadimu", install: "Kamu pasang aplikasinya — halamanmu langsung tayang", here: "kamu di sini" },
    early: "Kami masih tahap awal — trek yang bergabung duluan ikut membentuk apa yang dibangun, dan dukungan awal akan dibalas seiring DirtBikeX tumbuh.",
  },
  pt: {
    subject: "Uma comunidade feita para pistas como a {track}",
    lead: "Olá, equipe da {track},",
    intro: "Sou o Rubio — piloto e desenvolvedor de software de profissão — e estou criando o DirtBikeX: uma comunidade feita só para a galera do dirt bike e do motocross. Já disponível para iOS e desktop — não é mais um feed para você gerenciar, mas um lugar focado, baseado em fórum e sem ruído, onde todo mundo está ali só para pilotar.",
    value: "Eu gostaria de criar uma página gratuita para a {track} nela. Seus canais já alcançam os pilotos que te conhecem — isto é para os que ainda não conhecem: pilotos procurando pista no mapa, de passagem ou começando agora. Um catálogo global de pistas, com a {track} dentro.",
    cta: "Se topar, é só responder.",
    look: "Aqui vai um olhar de 30 segundos:",
    steps: { title: "Levar a {track} para o DirtBikeX — quatro passos simples:", got: "Você recebeu este e-mail", reply: "Você responde aceitando", invite: "Eu envio seu convite pessoal", install: "Você instala o app — sua página fica no ar", here: "você está aqui" },
    early: "Estamos começando — as primeiras pistas a bordo moldam o que será construído, e quem apoiar cedo será recompensado conforme o DirtBikeX crescer.",
  },
  fa_IR: {
    subject: "جامعه‌ای که مخصوص پیست‌هایی مثل {track} ساخته شده",
    lead: "سلام تیم {track}،",
    intro: "من Rubio هستم؛ یک موتورسوار که کارش برنامه‌نویسی است و دارم DirtBikeX را می‌سازم: جامعه‌ای که مخصوص آدم‌های دنیای درت‌بایک و موتوکراس ساخته شده. حالا روی iOS و دسکتاپ در دسترس است — نه یک فید دیگر که باید مدیریتش کنی، بلکه جایی متمرکز و مبتنی بر انجمن و بدون شلوغی، که هر کسی آنجاست فقط برای رایدینگ آمده.",
    value: "دوست دارم آنجا برای {track} یک صفحهٔ رایگان بسازم. کانال‌های خودت به موتورسوارهایی می‌رسند که از قبل تو را می‌شناسند — این برای کسانی است که هنوز نمی‌شناسند: موتورسوارهایی که روی نقشه دنبال پیست می‌گردند، در حال سفرند، یا تازه شروع کرده‌اند. یک فهرست جهانی پیست‌ها، و {track} در آن است.",
    cta: "اگر موافقی، فقط پاسخ بده.",
    look: "یک نگاه ۳۰ ثانیه‌ای:",
    steps: { title: "بردن {track} به DirtBikeX — چهار قدم کوچک:", got: "این ایمیل به دستت رسید", reply: "با پاسخ‌دادن موافقت می‌کنی", invite: "دعوت‌نامهٔ شخصی‌ات را می‌فرستم", install: "اپ را نصب می‌کنی — صفحه‌ات فعال می‌شود", here: "اینجا هستی" },
    early: "هنوز اول راهیم — پیست‌های اول مسیر ساخت را شکل می‌دهند و حمایت‌های اولیه با رشد DirtBikeX جبران خواهد شد.",
  },
  fi: {
    subject: "Yhteisö, joka on tehty {track}:n kaltaisille radoille",
    lead: "Hei {track}-tiimi,",
    intro: "Olen Rubio – kuljettaja ja työkseni ohjelmistokehittäjä – ja rakennan DirtBikeX:ää: yhteisöä, joka on tehty vain dirtbike- ja motocross-väelle. Nyt saatavilla iOS:lle ja tietokoneelle – ei taas yksi syöte hallittavaksi, vaan keskittynyt, foorumipohjainen paikka ilman kohinaa, jossa kaikki ovat vain ajamista varten.",
    value: "Haluaisin tehdä {track}:lle sinne ilmaisen sivun. Omat kanavasi tavoittavat kuljettajat, jotka jo tuntevat sinut — tämä on niitä varten, jotka eivät vielä tunne: kuljettajia, jotka etsivät rataa kartalta, ovat läpikulkumatkalla tai vasta aloittamassa. Yksi maailmanlaajuinen rataluettelo, ja {track} on siinä.",
    cta: "Jos olet mukana, vastaa vain.",
    look: "Tässä 30 sekunnin katsaus:",
    steps: { title: "{track} DirtBikeX:ään — neljä pientä askelta:", got: "Sait tämän viestin", reply: "Vastaat ja suostut", invite: "Lähetän henkilökohtaisen kutsusi", install: "Asennat sovelluksen — sivusi on julki", here: "olet tässä" },
    early: "Olemme vasta alussa — ensimmäiset radat muovaavat sitä, mitä rakennetaan, ja varhainen tuki palkitaan DirtBikeX:n kasvaessa.",
  },
  nl: {
    subject: "Een community gemaakt voor banen zoals {track}",
    lead: "Hallo team van {track},",
    intro: "Ik ben Rubio – rijder en van beroep softwareontwikkelaar – en ik bouw DirtBikeX: een community speciaal voor dirtbike- en motocrossmensen. Nu beschikbaar op iOS en desktop – niet nóg een feed om te beheren, maar een gerichte, forumgebaseerde plek zonder ruis, waar iedereen er is om te rijden.",
    value: "Ik wil daar graag een gratis pagina voor {track} aanmaken. Je eigen kanalen bereiken de rijders die je al kennen — dit is voor wie je nog niet kent: rijders die op de kaart een baan zoeken, op doorreis zijn of net beginnen. Eén wereldwijde banencatalogus, met {track} erin.",
    cta: "Doe je mee, reageer dan gewoon.",
    look: "Hier is een blik van 30 seconden:",
    steps: { title: "{track} op DirtBikeX — vier kleine stappen:", got: "Je kreeg deze mail", reply: "Je antwoordt en zegt ja", invite: "Ik stuur je persoonlijke uitnodiging", install: "Je installeert de app — je pagina staat live", here: "je bent hier" },
    early: "We staan nog aan het begin — de eerste banen bepalen mee wat er gebouwd wordt, en vroege steun wordt beloond naarmate DirtBikeX groeit.",
  },
  tr_TR: {
    subject: "{track} gibi pistler için özel yapılmış bir topluluk",
    lead: "Merhaba {track} ekibi,",
    intro: "Ben Rubio — hem sürücü hem de mesleği yazılım geliştirmek olan biri — ve DirtBikeX'i geliştiriyorum: dirt bike ve motokros dünyasının insanları için özel olarak yapılmış bir topluluk. Artık iOS ve masaüstünde kullanılabiliyor — yönetmen gereken bir akış daha değil, odaklanmış, forum tabanlı, gürültüsüz bir yer; oradaki herkes yalnızca sürmek için orada.",
    value: "Orada {track} için ücretsiz bir sayfa oluşturmak isterim. Kendi kanalların zaten seni tanıyan sürücülere ulaşıyor — bu, henüz tanımayanlar için: haritada sürecek yer arayan, yoldan geçen ya da spora yeni başlayan sürücüler. Tek bir küresel pist kataloğu ve {track} onun içinde.",
    cta: "Varsan, yanıtlaman yeterli.",
    look: "30 saniyelik bir bakış:",
    steps: { title: "{track}'i DirtBikeX'e taşımak — dört küçük adım:", got: "Bu e-postayı aldın", reply: "Yanıtlayıp onay veriyorsun", invite: "Kişisel davetini gönderiyorum", install: "Uygulamayı kuruyorsun — sayfan yayında", here: "buradasın" },
    early: "Henüz yolun başındayız — ilk katılan pistler neyin inşa edileceğini şekillendiriyor ve erken destek DirtBikeX büyüdükçe karşılığını bulacak.",
  },
  vi: {
    subject: "Một cộng đồng dành riêng cho những đường đua như {track}",
    lead: "Chào đội ngũ {track},",
    intro: "Tôi là Rubio — một tay đua đồng thời làm nghề viết phần mềm — và tôi đang xây dựng DirtBikeX: một cộng đồng dành riêng cho những người chơi dirt bike và motocross. Hiện đã có trên iOS và máy tính — không phải thêm một bảng tin để bạn quản lý, mà là một nơi tập trung, dựa trên diễn đàn, không nhiễu, nơi ai cũng đến chỉ để chạy xe.",
    value: "Tôi muốn tạo cho {track} một trang miễn phí trong đó. Các kênh của bạn đã chạm tới những tay đua biết bạn rồi — cái này dành cho những người chưa biết: tay đua tìm đường đua trên bản đồ, đi ngang qua, hoặc mới chơi. Một danh mục đường đua toàn cầu, và {track} có mặt trong đó.",
    cta: "Nếu bạn tham gia, chỉ cần trả lời.",
    look: "Xem thử trong 30 giây:",
    steps: { title: "Đưa {track} lên DirtBikeX — bốn bước nhỏ:", got: "Bạn nhận được thư này", reply: "Bạn trả lời để đồng ý", invite: "Tôi gửi lời mời cá nhân của bạn", install: "Bạn cài ứng dụng — trang của bạn lên sóng", here: "bạn đang ở đây" },
    early: "Chúng tôi mới ở giai đoạn đầu — những đường đua tham gia sớm sẽ định hình những gì được xây, và sự ủng hộ sớm sẽ được đền đáp khi DirtBikeX lớn lên.",
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
    "你好，{track} 团队 👋 我是 Rubio——一名以写软件为生的车手。我做了 DirtBikeX：一个专为越野摩托和摩托越野人群打造的 App。我们主页上有一个 30 秒的介绍。",
    "我想免费给 {track} 建一个主页——你会出现在车手地图上，本地车手关注你，你的活动可以收报名。设置我来搞定；有兴趣的话，我直接在这里发你专属邀请。更多信息：{landing}",
  ] },
  ja: { messages: [
    "こんにちは、{track} のご担当者さま 👋 Rubio と申します。ソフトウェアを書いて生計を立てているライダーです。DirtBikeX という、ダートバイクとモトクロスのためだけのアプリを作りました。プロフィールに 30 秒の紹介があります。",
    "{track} の無料ページをご用意したいです。ライダーの地図に載り、地元のライダーがフォローし、イベントには参加登録が集まります。設定はこちらで対応します。ご興味があれば、このまま専用招待をお送りします。詳しくは {landing}",
  ] },
  zh_TW: { messages: [
    "你好，{track} 團隊 👋 我是 Rubio——一名以寫程式維生的車手。我做了 DirtBikeX：一個專為越野摩托與越野賽車愛好者打造的 App。我們主頁上有一支 30 秒的介紹。",
    "我想免費為 {track} 建立主頁——你會出現在車手地圖上，在地車手追蹤你，你的活動可以收報名。設定我來處理；有興趣的話，我直接在這裡寄給你專屬邀請。更多資訊：{landing}",
  ] },
  ko: { messages: [
    "안녕하세요, {track} 팀 👋 저는 Rubio입니다. 소프트웨어를 만들며 먹고사는 라이더예요. 더트바이크와 모토크로스만을 위한 앱 DirtBikeX를 만들었습니다. 프로필에 30초 소개가 있어요.",
    "{track}의 무료 페이지를 만들어 드리고 싶어요 — 라이더 지도에 실리고, 지역 라이더가 팔로우하고, 이벤트에 참석 신청을 받을 수 있어요. 설정은 제가 할게요. 관심 있으시면 여기로 바로 개인 초대장을 보내드릴게요. 자세한 건 {landing}",
  ] },
  de: { messages: [
    "Hi {track}-Team 👋 Ich bin Rubio — Fahrer und hauptberuflich Softwareentwickler. Ich habe DirtBikeX gebaut: eine App nur für Dirtbike- und Motocross-Leute. Auf unserem Profil gibt's einen 30-Sekunden-Einblick.",
    "Ich würde {track} gern eine kostenlose Seite einrichten — du bist auf der Fahrerkarte, Locals folgen dir, deine Events sammeln Zusagen. Die Einrichtung übernehme ich; wenn du dabei bist, schicke ich dir die persönliche Einladung direkt hier. Mehr auf {landing}",
  ] },
  it: { messages: [
    "Ciao team di {track} 👋 Sono Rubio — un rider che di mestiere scrive software. Ho creato DirtBikeX: un'app solo per chi vive dirt bike e motocross. Sul nostro profilo c'è uno sguardo di 30 secondi.",
    "Mi piacerebbe creare una pagina gratuita per {track} — sei sulla mappa dei rider, i locali ti seguono, i tuoi eventi raccolgono adesioni. Alla configurazione penso io; se ci stai, ti mando l'invito personale direttamente qui. Altro su {landing}",
  ] },
  fr: { messages: [
    "Salut l'équipe de {track} 👋 Moi c'est Rubio — pilote et développeur de logiciels au quotidien. J'ai créé DirtBikeX : une appli rien que pour les passionnés de dirt bike et de motocross. Sur notre profil, il y a un aperçu de 30 secondes.",
    "J'aimerais créer une page gratuite pour {track} — tu es sur la carte des pilotes, les locaux te suivent, tes événements récoltent des inscriptions. Je m'occupe de tout mettre en place ; si ça te dit, je t'envoie ton invitation personnelle directement ici. Plus d'infos : {landing}",
  ] },
  es: { messages: [
    "Hola, equipo de {track} 👋 Soy Rubio — piloto y programador de profesión. Hice DirtBikeX: una app solo para la gente del dirt bike y el motocross. En nuestro perfil hay un vistazo de 30 segundos.",
    "Me gustaría crear una página gratis para {track} — sales en el mapa de pilotos, los locales te siguen y tus eventos reciben inscripciones. De la configuración me encargo yo; si te apuntas, te mando la invitación personal por aquí mismo. Más en {landing}",
  ] },
  ar: { messages: [
    "مرحبًا فريق {track} 👋 أنا Rubio — سائق أعمل في تطوير البرمجيات. صنعت DirtBikeX: تطبيقًا مخصّصًا لعشّاق الدراجات الترابية والموتوكروس. في ملفنا الشخصي لمحة من 30 ثانية.",
    "أودّ أن أنشئ لـ {track} صفحة مجانية — تظهر على خريطة السائقين، ويتابعك المحليون، وتستقبل فعالياتك التسجيلات. الإعداد عليّ؛ وإن كنت موافقًا أرسل لك دعوتك الشخصية هنا مباشرة. المزيد على {landing}",
  ] },
  da: { messages: [
    "Hej {track}-team 👋 Jeg er Rubio — kører og softwareudvikler til daglig. Jeg har lavet DirtBikeX: en app kun til dirtbike- og motocross-folk. På vores profil er der et kig på 30 sekunder.",
    "Jeg vil gerne oprette en gratis side til {track} — du kommer på kørernes kort, lokale følger dig, og dine events samler tilmeldinger. Jeg klarer opsætningen; er du med, sender jeg din personlige invitation lige her. Mere på {landing}",
  ] },
  el: { messages: [
    "Γεια σου, ομάδα της {track} 👋 Είμαι ο Rubio — αναβάτης και επαγγελματίας προγραμματιστής. Έφτιαξα το DirtBikeX: μια εφαρμογή μόνο για τον κόσμο του dirt bike και του motocross. Στο προφίλ μας υπάρχει μια ματιά 30 δευτερολέπτων.",
    "Θα ήθελα να φτιάξω μια δωρεάν σελίδα για την {track} — μπαίνεις στον χάρτη των αναβατών, οι ντόπιοι σε ακολουθούν, οι εκδηλώσεις σου μαζεύουν συμμετοχές. Τη ρύθμιση την αναλαμβάνω εγώ· αν είσαι μέσα, σου στέλνω την πρόσκληση εδώ. Περισσότερα στο {landing}",
  ] },
  sv: { messages: [
    "Hej {track}-teamet 👋 Jag heter Rubio — förare och mjukvaruutvecklare till vardags. Jag har byggt DirtBikeX: en app bara för dirtbike- och motocrossfolk. På vår profil finns en titt på 30 sekunder.",
    "Jag vill gärna skapa en gratis sida för {track} — du hamnar på förarkartan, lokala förare följer dig och dina event samlar anmälningar. Jag fixar uppsättningen; är du med skickar jag din personliga inbjudan direkt här. Mer på {landing}",
  ] },
  th: { messages: [
    "สวัสดีทีม {track} 👋 ผมชื่อ Rubio นักขี่ที่ทำงานเขียนซอฟต์แวร์เป็นอาชีพ ผมสร้าง DirtBikeX แอปสำหรับคนสายเดิร์ทไบก์และโมโตครอสโดยเฉพาะ ในโปรไฟล์ของเรามีคลิปแนะนำ 30 วินาที",
    "ผมอยากสร้างเพจฟรีให้ {track} — คุณจะอยู่บนแผนที่นักขี่ นักขี่ท้องถิ่นติดตามคุณ และอีเวนต์ของคุณรับลงชื่อเข้าร่วมได้ เรื่องตั้งค่าผมจัดการเอง ถ้าสนใจ ผมจะส่งคำเชิญส่วนตัวให้ตรงนี้เลย ดูเพิ่มที่ {landing}",
  ] },
  id: { messages: [
    "Halo tim {track} 👋 Saya Rubio — rider yang sehari-hari menulis perangkat lunak. Saya membuat DirtBikeX: aplikasi khusus untuk orang dirt bike dan motocross. Di profil kami ada cuplikan 30 detik.",
    "Saya ingin membuatkan {track} halaman gratis — kamu tampil di peta rider, rider lokal mengikutimu, dan acaramu bisa menerima pendaftaran. Pengaturan biar saya yang urus; kalau mau, saya kirim undangan pribadimu langsung di sini. Selengkapnya di {landing}",
  ] },
  pt: { messages: [
    "Oi, equipe da {track} 👋 Sou o Rubio — piloto e desenvolvedor de software de profissão. Criei o DirtBikeX: um app só para a galera do dirt bike e do motocross. No nosso perfil tem uma prévia de 30 segundos.",
    "Eu gostaria de criar uma página gratuita para a {track} — você entra no mapa dos pilotos, a galera local te segue e seus eventos recebem confirmações. Da configuração eu cuido; se topar, mando seu convite pessoal por aqui mesmo. Mais em {landing}",
  ] },
  fa_IR: { messages: [
    "سلام تیم {track} 👋 من Rubio هستم — موتورسواری که کارش برنامه‌نویسی است. DirtBikeX را ساخته‌ام: اپی فقط برای اهالی درت‌بایک و موتوکراس. در پروفایل ما یک معرفی ۳۰ ثانیه‌ای هست.",
    "دوست دارم برای {track} یک صفحهٔ رایگان بسازم — روی نقشهٔ موتورسوارها دیده می‌شوی، محلی‌ها دنبالت می‌کنند و رویدادهایت ثبت‌نام می‌گیرند. راه‌اندازی با من؛ اگر موافقی، دعوت‌نامهٔ شخصی‌ات را همین‌جا می‌فرستم. بیشتر در {landing}",
  ] },
  fi: { messages: [
    "Hei {track}-tiimi 👋 Olen Rubio — kuljettaja ja työkseni ohjelmistokehittäjä. Tein DirtBikeX:n: sovelluksen vain dirtbike- ja motocross-väelle. Profiilissamme on 30 sekunnin katsaus.",
    "Haluaisin tehdä {track}:lle ilmaisen sivun — pääset kuljettajien kartalle, paikalliset seuraavat sinua ja tapahtumasi keräävät ilmoittautumisia. Hoidan käyttöönoton; jos olet mukana, lähetän henkilökohtaisen kutsun suoraan tässä. Lisää: {landing}",
  ] },
  nl: { messages: [
    "Hoi team van {track} 👋 Ik ben Rubio — rijder en van beroep softwareontwikkelaar. Ik heb DirtBikeX gemaakt: een app alleen voor dirtbike- en motocrossmensen. Op ons profiel staat een blik van 30 seconden.",
    "Ik wil graag een gratis pagina voor {track} aanmaken — je staat op de rijderskaart, locals volgen je en je events verzamelen aanmeldingen. De installatie regel ik; doe je mee, dan stuur ik je persoonlijke uitnodiging gewoon hier. Meer op {landing}",
  ] },
  tr_TR: { messages: [
    "Merhaba {track} ekibi 👋 Ben Rubio — mesleği yazılım geliştirmek olan bir sürücü. DirtBikeX'i yaptım: sadece dirt bike ve motokros dünyası için bir uygulama. Profilimizde 30 saniyelik bir tanıtım var.",
    "{track} için ücretsiz bir sayfa oluşturmak isterim — sürücü haritasında yer alırsın, yereller seni takip eder, etkinliklerin katılım toplar. Kurulumu ben hallederim; varsan, kişisel davetini doğrudan buradan gönderirim. Daha fazlası: {landing}",
  ] },
  vi: { messages: [
    "Chào đội {track} 👋 Tôi là Rubio — một tay đua làm nghề viết phần mềm. Tôi đã làm DirtBikeX: ứng dụng dành riêng cho người chơi dirt bike và motocross. Trên trang cá nhân của chúng tôi có video giới thiệu 30 giây.",
    "Tôi muốn tạo cho {track} một trang miễn phí — bạn có mặt trên bản đồ tay đua, người địa phương theo dõi bạn, sự kiện của bạn nhận đăng ký tham gia. Việc thiết lập cứ để tôi lo; nếu bạn tham gia, tôi sẽ gửi lời mời cá nhân ngay tại đây. Xem thêm tại {landing}",
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
  /** Why this tick did nothing, when it did nothing on purpose.
   *
   *  `scheduled()` logs this whole object every minute, and an all-zeros line used to be
   *  indistinguishable from a stalled drip — which is how a 24-minute outage was once found
   *  by eyeball rather than by alert. An idle tick now says so, and says which kind, so
   *  "quiet because there is no work" never reads as "quiet because it is broken". */
  idle?: 'disabled' | 'empty';
}

/**
 * The drip's kill switch. Opt-OUT: only an explicit "0" / "false" / "off" / "no" stops it.
 * Mirrors `uploadsEnabled` in trailUpload.ts — same reasoning, same accepted values.
 */
function dripEnabled(env: PagesEnv): boolean {
  const raw = String(env.OUTREACH_DRIP_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
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

  // Durable off-switch. Absent = enabled (opt-out), matching TRAILS_UPLOAD_ENABLED: a switch
  // that arms itself on a missing or misspelled var takes a shipped feature down on a deploy
  // nobody thought was risky.
  //
  // This is the ONLY safe way to stop the drip. Removing RESEND_API_KEY or JOIN_FROM_EMAIL
  // trips the pre-flight above and looks like a kill switch, but both are shared with the
  // waitlist double-opt-in mail (join.ts) — you would silently break confirmation emails.
  // OUTREACH_ALLOW_REAL=0 and OUTREACH_DAILY_CAP=0 do not stop it either; both guards sit
  // downstream of the scan this exists to avoid.
  if (!dripEnabled(env)) { out.idle = 'disabled'; return out; }

  // Is there anything to do at all? One probe on idx_outreach_status reads ~1 row; the
  // sent_today count below full-scans every row ever sent to answer a question that is
  // always 0 while the queue is empty. Measured on prod 2026-08-31: 1.82M of ~1.84M D1
  // rows/day went into that count, accomplishing nothing.
  //
  // 'claimed' is in the probe on purpose — without it a tick that died mid-send would leave
  // rows claimed forever, because the reaper below would never run again.
  const pending = await db.prepare(
    "SELECT 1 FROM outreach WHERE status IN ('queued','claimed') LIMIT 1"
  ).first();
  if (!pending) { out.idle = 'empty'; return out; }

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
