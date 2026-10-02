/**
 * NomadCare v2 — MOD.01 "Dịch y tế 1 chạm" phrasebook data (owner: P1 phrases).
 * Public API: window.NC_PHRASES (plain data) + NC_PHRASES.find(code) (non-enumerable).
 * Side effect: registers 2 missing body-group icons ('abdomen', 'person-standing') via NC.icons.add when absent.
 * Consumed by assets/js/app/mod01-translate.js; also loadable in Node (module.exports) for tests.
 *
 * ─── Structure ───────────────────────────────────────────────────────────────
 * NC_PHRASES = {
 *   version, updated, review:{status, back_translation, round1, approver, note, note_en},
 *   languages:[{code, name, name_en, tts, core}],     // 'vi' is always the staff side
 *   severities:[{id:'mild'|'moderate'|'severe', label:{7}, hint:{7}}],  // hint = generic sub-label; never names 115
 *   groups:[{                                         // exactly 6 body groups (PDF 6.2)
 *     id, icon, label:{7},
 *     symptoms:[{ id, icon?, label:{7},
 *                 phrases?:{mild:P, moderate:P, severe:P},              // leaf symptom
 *                 hints?:{mild?:{7}, moderate?:{7}, severe?:{7}},       // leaf override of severities[].hint
 *                 labels?:{mild?:{7}, moderate?:{7}, severe?:{7}},      // leaf override of severities[].label
 *                 children?:[{id, label:{7}, phrases:{mild,moderate,severe}, hints?, labels?}] }]  // 2nd level
 *   }],
 *   quick:[{id, icon, urgent?, lead?:{7}, text:{7}, text_behalf?:{7}}], // one-tap phrases; lead = staff lead-line
 *                                                     // override; text_behalf = wording while the user speaks for a
 *                                                     // companion (phrases that point at "my phone / my QR")
 *   staff:[{id, text:{7}, answers:[{id, text:{7}}]}], // questions staff ask (VI source) + tap-able answers
 *   templates:{blood, allergy, condition, medication, // {7} strings with a "{x}" slot (from MOD.03 profile)
 *              allergy_none, condition_none, medication_none, blood_unknown},  // {7}, no slot ("Không có"/unknown)
 *   sources:[{id, short, short_en, title, title_en, year|null, scope:{vi,en}}]  // terminology source (Bảng PL.3)
 * }
 * Severity hints/labels: a leaf's `hints`/`labels` (when present) replace the generic ones for that leaf only.
 * No hint mentions 115: the UI adds its own 115 cue exactly when the resulting phrase is `urgent`.
 * P = {code:'MOD01-<GROUP>-<NN>-<S>', urgent:bool, text:{vi,en,zh,ko,ja,ru,fr}}
 *   GROUP ∈ HEAD|CHEST|ABD|ARM|LEG|SKIN · NN = leaf number inside the group (01..)
 *   S = severity level: 1 = mild (Nhẹ), 2 = moderate (Vừa), 3 = severe (Nặng).
 *   urgent:true ⇒ time-critical; the sentence ends with an explicit request for emergency care
 *   (UI should surface the 115 button). Every node carries all 3 severities and all 7 languages.
 *   Urgency follows the MOD.05 first-aid library (firstaid.js call115/red flags): a phrase that describes
 *   a MOD.05 "call 115" trigger is urgent, and a severe phrase is true when ANY one listed sign is present.
 *   Codes are the audit key (shown on the result screen, logged in MOD.01 timings). Never renumber:
 *   append new leaves at the end of their group instead (MOD01-ABD-07 was appended in 1.1.0-demo).
 * NC_PHRASES.find(code) → {code, urgent, text, phrase:P, severity, group, symptom, child|null} | null.
 * {7} = {vi, en, zh, ko, ja, ru, fr}. zh = Simplified Chinese. Sentences are first-person patient
 * statements describing symptoms only (no diagnoses). ru/fr avoid gendered past forms on purpose.
 *
 * ─── Medical content status (PDF mục 8.1 "Bảo đảm chất lượng y tế") ─────────
 * DEMO CONTENT. Round 1 (team drafting) only. Before any release to real users it REQUIRES:
 *   (1) round-2 review and sign-off by a licensed medical advisor with emergency experience,
 *   (2) back-translation check (EN→VI, then VI→EN by a second person) for every language,
 *   (3) a version number + approval date shown in the app (see content_releases / NC.data.contentRelease()).
 * Do not edit phrase text without bumping `version` and resetting review.status to 'in_review'.
 *
 * ─── 1.1.0-demo (2026-09-28) — internal medical/translation review, still round 1 ───
 * Urgency aligned with MOD.05: HEAD-02-2, CHEST-01-2, SKIN-03-2, SKIN-04-2 → urgent. ABD-05-2, ARM-07-2 and
 * HEAD-04-2 reworded so the non-urgent level no longer describes a MOD.05 call-115 sign (cannot drink, arm
 * weakness, loss of balance). Severe phrases now read "A, B or C" so one red flag is enough. New leaf
 * MOD01-ABD-07 (poisoning), all levels urgent. Leaf hints/labels (snakebite, poisoning, animal bite, urgent
 * moderate levels); severe hint no longer names 115; ko '중간'; q-on-behalf lead; *_none templates; zh/ko/ja/ru/fr/en
 * wording fixes; no self-diagnosis ("I think it may be broken" removed).
 * 2026-09-29 (same version, still round 1): HEAD-05 (eye) aligned with the MOD.05 eye guide — blurred vision needs a
 * doctor at once: moderate hint "cần được khám ngay" and HEAD-05-2 ends "Tôi cần được khám ngay" (urgency and codes
 * unchanged; HEAD-05-3 stays urgent). text_behalf for q-qr-profile, q-drug-allergy, q-contact-family: in "speaking for
 * my companion" mode they no longer send staff to the phone owner's QR / profile.
 */
(function (root) {
  'use strict';

  /* Leaf-level severity hint shared by leaves whose MODERATE phrase is urgent (MOD.05 says call 115 for it). */
  var HINT_MODERATE_NOW = {
    vi: "Khá nặng — cần được khám ngay",
    en: "Quite bad — I need to be seen now",
    zh: "比较严重——需要马上就医",
    ko: "꽤 심해요 — 바로 진료가 필요해요",
    ja: "かなりつらい — すぐに診察が必要",
    ru: "Довольно сильно — нужен врач прямо сейчас",
    fr: "Assez fort — je dois consulter tout de suite"
  };
  /* Label for a "mild" level that is still an emergency (snakebite, suspected poisoning): never "Nhẹ / Mild". */
  var LABEL_NO_SYMPTOMS = { vi: "Chưa có triệu chứng", en: "No symptoms yet", zh: "还没有症状", ko: "아직 증상 없음", ja: "まだ症状なし", ru: "Симптомов пока нет", fr: "Pas encore de symptômes" };

  var NC_PHRASES = {
    version: "1.1.0-demo",
    updated: "2026-09-29",
    review: {
      status: "in_review",
      back_translation: false,
      round1: "Nhóm Stormbreakers",
      approver: null,
      note: "Bản minh hoạ (vòng 1 – nhóm biên soạn). Chưa qua vòng 2 (cố vấn y tế ký duyệt) và chưa đối chiếu dịch ngược, nên không phát hành cho người dùng thật (mục 8.1).",
      note_en: "Demo content (round 1 – team draft). Not yet signed off by a medical advisor (round 2) nor back-translated; must not be released to real users (section 8.1)."
    },

    /* vi = staff side (always shown). Core pair is EN↔VI; other languages translate into VI. */
    languages: [
      { code: "vi", name: "Tiếng Việt", name_en: "Vietnamese", tts: "vi-VN", core: true },
      { code: "en", name: "English", name_en: "English", tts: "en-US", core: true },
      { code: "zh", name: "中文", name_en: "Chinese (Simplified)", tts: "zh-CN", core: false },
      { code: "ko", name: "한국어", name_en: "Korean", tts: "ko-KR", core: false },
      { code: "ja", name: "日本語", name_en: "Japanese", tts: "ja-JP", core: false },
      { code: "ru", name: "Русский", name_en: "Russian", tts: "ru-RU", core: false },
      { code: "fr", name: "Français", name_en: "French", tts: "fr-FR", core: false }
    ],

    severities: [
      {
        id: "mild",
        label: { vi: "Nhẹ", en: "Mild", zh: "轻度", ko: "가벼움", ja: "軽い", ru: "Лёгкая", fr: "Léger" },
        hint: {
          vi: "Khó chịu nhẹ, còn chịu được",
          en: "Mild discomfort, still bearable",
          zh: "轻微不适，还能忍受",
          ko: "조금 불편하지만 참을 만해요",
          ja: "少しつらいが、がまんできる",
          ru: "Небольшой дискомфорт, терпимо",
          fr: "Gêne légère, supportable"
        }
      },
      {
        id: "moderate",
        label: { vi: "Vừa", en: "Moderate", zh: "中度", ko: "중간", ja: "中くらい", ru: "Средняя", fr: "Modéré" },
        hint: {
          vi: "Khá nặng, cần được khám sớm",
          en: "Quite bad, I need to be seen soon",
          zh: "比较严重，需要尽快就医",
          ko: "꽤 심해서 빨리 진료가 필요해요",
          ja: "かなりつらく、早めに診察が必要",
          ru: "Довольно сильно, нужен врач в ближайшее время",
          fr: "Assez fort, je dois consulter rapidement"
        }
      },
      {
        id: "severe",
        label: { vi: "Nặng", en: "Severe", zh: "重度", ko: "심함", ja: "重い", ru: "Тяжёлая", fr: "Grave" },
        /* No "115" here: the UI adds the 115 cue only when the chosen phrase is urgent (7 severe phrases are not). */
        hint: {
          vi: "Rất nặng — cần được khám ngay",
          en: "Very bad — I need a doctor right away",
          zh: "非常严重——需要马上看医生",
          ko: "매우 심해요 — 바로 진료가 필요해요",
          ja: "とても重い — すぐに診察が必要",
          ru: "Очень тяжело — нужен врач прямо сейчас",
          fr: "Très grave — je dois voir un médecin tout de suite"
        }
      }
    ],

    groups: [
      /* ═════════════════════════════ 1. ĐẦU / HEAD ═════════════════════════════ */
      {
        id: "head",
        icon: "brain",
        label: { vi: "Đầu", en: "Head", zh: "头部", ko: "머리", ja: "頭", ru: "Голова", fr: "Tête" },
        symptoms: [
          {
            id: "head-injury",
            icon: "alert-triangle",
            label: { vi: "Va đập vùng đầu", en: "Head injury", zh: "头部撞伤", ko: "머리 부상", ja: "頭のけが", ru: "Травма головы", fr: "Choc à la tête" },
            phrases: {
              mild: { code: "MOD01-HEAD-01-1", urgent: false, text: {
                vi: "Tôi bị va đầu. Tôi vẫn tỉnh táo, chỉ hơi đau.",
                en: "I hit my head. I am fully alert and it only hurts a little.",
                zh: "我撞到了头。我意识清醒，只是有点疼。",
                ko: "머리를 부딪쳤어요. 의식은 또렷하고 조금만 아파요.",
                ja: "頭をぶつけました。意識ははっきりしていて、少し痛いだけです。",
                ru: "У меня ушиб головы. Я в сознании, боль небольшая.",
                fr: "Je me suis cogné la tête. Je reste lucide et j’ai seulement un peu mal."
              } },
              moderate: { code: "MOD01-HEAD-01-2", urgent: false, text: {
                vi: "Tôi bị va đầu, đau đầu nhiều, buồn nôn và chóng mặt.",
                en: "I hit my head. I have a bad headache, nausea and dizziness.",
                zh: "我撞到了头，现在头很痛，恶心，头晕。",
                ko: "머리를 부딪쳤는데 두통이 심하고 메스껍고 어지러워요.",
                ja: "頭をぶつけて、頭痛がひどく、吐き気とめまいがあります。",
                ru: "У меня ушиб головы: сильная головная боль, тошнота и головокружение.",
                fr: "Je me suis cogné la tête. J’ai très mal à la tête, des nausées et des vertiges."
              } },
              severe: { code: "MOD01-HEAD-01-3", urgent: true, text: {
                vi: "Tôi bị va đập mạnh vào đầu, sau đó bị bất tỉnh một lúc, lơ mơ hoặc nôn nhiều lần. Tôi cần cấp cứu.",
                en: "I hit my head hard, and since then I have passed out for a while, feel drowsy or have vomited several times. I need emergency help.",
                zh: "我头部受到重击，之后晕过去了一会儿、一直昏昏沉沉，或者吐了好几次。我需要急救。",
                ko: "머리를 세게 부딪친 뒤 잠시 의식을 잃었거나, 정신이 몽롱하거나, 여러 번 토했어요. 응급 치료가 필요해요.",
                ja: "頭を強く打ったあと、一時意識を失ったか、意識がぼんやりしているか、何度も吐きました。緊急の治療が必要です。",
                ru: "Сильный удар по голове: после него была потеря сознания, сонливость или повторная рвота. Мне нужна срочная медицинская помощь.",
                fr: "J’ai reçu un choc violent à la tête et, depuis, j’ai perdu connaissance un moment, je somnole ou j’ai vomi plusieurs fois. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            /* Motorbike falls: neck/back pain + numb/weak limbs must reach staff fast (spinal precautions). */
            id: "neck-back",
            icon: "bone",
            label: { vi: "Đau cổ, lưng sau ngã", en: "Neck or back pain after a fall", zh: "摔倒后脖子或背部疼", ko: "넘어진 뒤 목·등 통증", ja: "転倒後の首・背中の痛み", ru: "Боль в шее или спине после падения", fr: "Douleur au cou ou au dos après une chute" },
            /* MOD.05 head: marked neck/back pain after a fall ⇒ keep still + call 115, so moderate is urgent. */
            hints: { moderate: HINT_MODERATE_NOW },
            phrases: {
              mild: { code: "MOD01-HEAD-02-1", urgent: false, text: {
                vi: "Sau một cú ngã nhẹ, tôi hơi đau cổ hoặc lưng, vẫn cử động bình thường.",
                en: "After a minor fall, my neck or back hurts a little, but I can move normally.",
                zh: "我轻轻摔了一下，脖子或背部有点疼，但活动正常。",
                ko: "가볍게 넘어진 뒤 목이나 등이 조금 아프지만 평소처럼 움직일 수 있어요.",
                ja: "軽く転んだあと、首か背中が少し痛いですが、普通に動けます。",
                ru: "После лёгкого падения немного болит шея или спина, но двигаться могу нормально.",
                fr: "Après une petite chute, j’ai un peu mal au cou ou au dos, mais je bouge normalement."
              } },
              moderate: { code: "MOD01-HEAD-02-2", urgent: true, text: {
                vi: "Sau cú ngã, tôi đau nhiều ở cổ hoặc lưng, cử động là đau. Tôi cần cấp cứu.",
                en: "After a fall, I have a lot of pain in my neck or back, and it hurts to move. I need emergency help.",
                zh: "我摔倒后，脖子或背部很疼，一动就疼。我需要急救。",
                ko: "넘어진 뒤 목이나 등이 많이 아프고 움직이면 아파요. 응급 치료가 필요해요.",
                ja: "転んだあと、首か背中がかなり痛く、動くと痛みます。緊急の治療が必要です。",
                ru: "После падения сильно болит шея или спина, больно двигаться. Мне нужна срочная медицинская помощь.",
                fr: "Après une chute, j’ai très mal au cou ou au dos, et bouger me fait mal. J’ai besoin d’une aide médicale urgente."
              } },
              severe: { code: "MOD01-HEAD-02-3", urgent: true, text: {
                vi: "Sau cú ngã, tay hoặc chân tôi bị tê, yếu đi hoặc không cử động được. Tôi cần cấp cứu.",
                en: "Since the fall, my arms or legs are numb or weak, or I cannot move them. I need emergency help.",
                zh: "摔倒后，我的手脚发麻、无力，或者动不了。我需要急救。",
                ko: "넘어진 뒤 팔다리가 저리거나 힘이 빠지거나 움직일 수 없어요. 응급 치료가 필요해요.",
                ja: "転んだあと、手足がしびれたり、力が入らなかったり、動かせなかったりします。緊急の治療が必要です。",
                ru: "После падения руки или ноги онемели, ослабли или не двигаются. Мне нужна срочная медицинская помощь.",
                fr: "Depuis la chute, mes bras ou mes jambes sont engourdis ou faibles, ou je ne peux plus les bouger. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "headache",
            icon: "zap",
            label: { vi: "Đau đầu", en: "Headache", zh: "头痛", ko: "두통", ja: "頭痛", ru: "Головная боль", fr: "Mal de tête" },
            phrases: {
              mild: { code: "MOD01-HEAD-03-1", urgent: false, text: {
                vi: "Tôi bị đau đầu nhẹ.",
                en: "I have a mild headache.",
                zh: "我有点头痛。",
                ko: "머리가 조금 아파요.",
                ja: "少し頭痛がします。",
                ru: "У меня несильно болит голова.",
                fr: "J’ai un léger mal de tête."
              } },
              moderate: { code: "MOD01-HEAD-03-2", urgent: false, text: {
                vi: "Tôi đau đầu nhiều, đã uống thuốc giảm đau nhưng không đỡ.",
                en: "I have a bad headache. I took painkillers but they have not helped.",
                zh: "我头很痛，吃了止痛药也没有好转。",
                ko: "머리가 많이 아파요. 진통제를 먹었는데 나아지지 않아요.",
                ja: "頭痛がひどいです。痛み止めを飲みましたが、よくなりません。",
                ru: "У меня сильно болит голова, обезболивающее не помогло.",
                fr: "J’ai très mal à la tête. J’ai pris un antidouleur, sans effet."
              } },
              severe: { code: "MOD01-HEAD-03-3", urgent: true, text: {
                vi: "Tôi đột ngột đau đầu dữ dội, chưa bao giờ đau như vậy. Tôi cần cấp cứu.",
                en: "I suddenly have a severe headache, the worst I have ever had. I need emergency help.",
                zh: "我突然剧烈头痛，从来没有这么痛过。我需要急救。",
                ko: "갑자기 머리가 심하게 아파요. 이렇게 아픈 건 처음이에요. 응급 치료가 필요해요.",
                ja: "突然ひどい頭痛がしています。こんなに痛いのは初めてです。緊急の治療が必要です。",
                ru: "У меня внезапная сильнейшая головная боль, такой никогда не было. Мне нужна срочная медицинская помощь.",
                fr: "J’ai soudain un mal de tête violent, le pire de ma vie. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "dizziness",
            icon: "refresh",
            label: { vi: "Chóng mặt, choáng", en: "Dizziness, feeling faint", zh: "头晕、眼前发黑", ko: "어지러움·실신할 것 같음", ja: "めまい・気が遠くなる", ru: "Головокружение, дурнота", fr: "Vertiges, malaise" },
            phrases: {
              mild: { code: "MOD01-HEAD-04-1", urgent: false, text: {
                vi: "Tôi hơi chóng mặt.",
                en: "I feel a little dizzy.",
                zh: "我有点头晕。",
                ko: "조금 어지러워요.",
                ja: "少しめまいがします。",
                ru: "У меня немного кружится голова.",
                fr: "J’ai un peu la tête qui tourne."
              } },
              moderate: { code: "MOD01-HEAD-04-2", urgent: false, text: {
                vi: "Tôi chóng mặt, buồn nôn khi đổi tư thế, nằm nghỉ thì đỡ.",
                en: "I feel dizzy and nauseous when I change position, and it eases when I lie down.",
                zh: "我一变换姿势就头晕、恶心，躺下休息会好一些。",
                ko: "자세를 바꾸면 어지럽고 메스꺼운데, 누워서 쉬면 나아져요.",
                ja: "姿勢を変えるとめまいと吐き気がしますが、横になると楽になります。",
                ru: "Когда меняю положение тела, кружится голова и подташнивает; лёжа становится легче.",
                fr: "J’ai des vertiges et des nausées quand je change de position, et ça va mieux quand je m’allonge."
              } },
              /* Sudden loss of balance is the "B" of BE-FAST (MOD.05 stroke), so it belongs to the urgent level. */
              severe: { code: "MOD01-HEAD-04-3", urgent: true, text: {
                vi: "Tôi đột ngột chóng mặt dữ dội, mất thăng bằng hoặc cảm giác sắp ngất. Tôi cần cấp cứu.",
                en: "I suddenly feel very dizzy, cannot keep my balance, or feel like I am about to faint. I need emergency help.",
                zh: "我突然头晕得很厉害、站不稳，或者感觉快要晕倒了。我需要急救。",
                ko: "갑자기 심하게 어지럽거나, 균형을 잡을 수 없거나, 곧 쓰러질 것 같아요. 응급 치료가 필요해요.",
                ja: "突然ひどいめまいがする、体のバランスがとれない、または今にも倒れそうです。緊急の治療が必要です。",
                ru: "Внезапно сильно кружится голова, я не могу удержать равновесие или вот-вот потеряю сознание. Мне нужна срочная медицинская помощь.",
                fr: "J’ai soudain de forts vertiges, je perds l’équilibre ou je sens que je vais m’évanouir. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "eye",
            icon: "eye",
            label: { vi: "Đau, tổn thương mắt", en: "Eye pain or injury", zh: "眼睛疼痛或受伤", ko: "눈 통증·부상", ja: "目の痛み・けが", ru: "Боль или травма глаза", fr: "Douleur ou blessure à l’œil" },
            /* MOD.05 eye: blurred or double vision ⇒ "call 115 or go to a medical facility at once" — never "khám sớm". */
            hints: { moderate: HINT_MODERATE_NOW },
            phrases: {
              mild: { code: "MOD01-HEAD-05-1", urgent: false, text: {
                vi: "Tôi bị bụi bay vào mắt, mắt cay và chảy nước mắt.",
                en: "I got dust in my eye. It stings and is watering.",
                zh: "我眼睛进了灰尘，又刺痛又流眼泪。",
                ko: "눈에 먼지가 들어가서 따갑고 눈물이 나요.",
                ja: "目にほこりが入って、しみて涙が出ます。",
                ru: "Мне в глаз попала пыль, глаз щиплет и слезится.",
                fr: "J’ai une poussière dans l’œil, il me pique et larmoie."
              } },
              moderate: { code: "MOD01-HEAD-05-2", urgent: false, text: {
                vi: "Mắt tôi đau, đỏ và nhìn mờ. Tôi cần được khám ngay.",
                en: "My eye hurts, is red, and my vision is blurry. I need to see a doctor right away.",
                zh: "我的眼睛疼、发红，看东西模糊。我需要马上看医生。",
                ko: "눈이 아프고 충혈됐으며 앞이 흐릿하게 보여요. 바로 진료를 받아야 해요.",
                ja: "目が痛くて赤くなり、かすんで見えます。すぐに診察が必要です。",
                ru: "Глаз болит и покраснел, зрение нечёткое. Мне нужно срочно к врачу.",
                fr: "J’ai mal à l’œil, il est rouge et ma vue est floue. J’ai besoin de voir un médecin tout de suite."
              } },
              severe: { code: "MOD01-HEAD-05-3", urgent: true, text: {
                vi: "Mắt tôi bị thương nặng (bị vật đâm hoặc hoá chất bắn vào), hoặc tôi gần như không nhìn thấy gì. Tôi cần cấp cứu.",
                en: "My eye is badly injured (something went into it or a chemical splashed into it), or I can hardly see. I need emergency help.",
                zh: "我的眼睛受了重伤（被东西刺伤或溅入了化学品），或者几乎看不见东西。我需要急救。",
                ko: "눈을 심하게 다쳤거나(무언가에 찔렸거나 화학물질이 튀었어요), 거의 보이지 않아요. 응급 치료가 필요해요.",
                ja: "目をひどくけがしたか（何かが刺さった、または化学物質が入った）、ほとんど見えません。緊急の治療が必要です。",
                ru: "У меня серьёзная травма глаза (в него что-то вонзилось или попало химическое вещество), или я почти ничего не вижу. Мне нужна срочная медицинская помощь.",
                fr: "Mon œil est gravement blessé (quelque chose l’a transpercé ou un produit chimique a giclé dedans), ou je ne vois presque plus rien. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "nosebleed",
            icon: "droplet",
            label: { vi: "Chảy máu mũi", en: "Nosebleed", zh: "流鼻血", ko: "코피", ja: "鼻血", ru: "Кровь из носа", fr: "Saignement de nez" },
            phrases: {
              mild: { code: "MOD01-HEAD-06-1", urgent: false, text: {
                vi: "Tôi bị chảy máu mũi ít.",
                en: "I have a small nosebleed.",
                zh: "我流了一点鼻血。",
                ko: "코피가 조금 나요.",
                ja: "少し鼻血が出ています。",
                ru: "У меня небольшое кровотечение из носа.",
                fr: "Je saigne un peu du nez."
              } },
              moderate: { code: "MOD01-HEAD-06-2", urgent: false, text: {
                vi: "Tôi chảy máu mũi hơn 10 phút, bóp mũi vẫn chưa cầm được.",
                en: "My nose has been bleeding for more than 10 minutes. Pinching it has not stopped it.",
                zh: "我流鼻血超过10分钟了，捏住鼻子也止不住。",
                ko: "코피가 10분 넘게 나고 있어요. 코를 눌러도 멈추지 않아요.",
                ja: "鼻血が10分以上続いています。鼻をつまんでも止まりません。",
                ru: "Кровь из носа идёт больше 10 минут, зажимание носа не помогает.",
                fr: "Je saigne du nez depuis plus de 10 minutes, même en le pinçant."
              } },
              severe: { code: "MOD01-HEAD-06-3", urgent: true, text: {
                vi: "Mũi tôi chảy máu rất nhiều và không cầm được, hoặc tôi thấy choáng như sắp ngất. Tôi cần cấp cứu.",
                en: "My nose is bleeding heavily and will not stop, or I feel faint. I need emergency help.",
                zh: "我鼻子大量出血、止不住，或者感觉快要晕倒了。我需要急救。",
                ko: "코피가 많이 나고 멈추지 않거나, 쓰러질 것처럼 어지러워요. 응급 치료가 필요해요.",
                ja: "鼻血が大量に出て止まらないか、気が遠くなりそうです。緊急の治療が必要です。",
                ru: "У меня сильное кровотечение из носа, которое не останавливается, или мне дурно. Мне нужна срочная медицинская помощь.",
                fr: "Je saigne abondamment du nez sans que ça s’arrête, ou j’ai l’impression que je vais m’évanouir. J’ai besoin d’une aide médicale urgente."
              } }
            }
          }
        ]
      },

      /* ═════════════════════════════ 2. NGỰC / CHEST ═════════════════════════════ */
      {
        id: "chest",
        icon: "heart-pulse",
        label: { vi: "Ngực", en: "Chest", zh: "胸部", ko: "가슴", ja: "胸", ru: "Грудь", fr: "Poitrine" },
        symptoms: [
          {
            id: "chest-pain",
            icon: "heart",
            label: { vi: "Đau, tức ngực", en: "Chest pain or tightness", zh: "胸痛、胸闷", ko: "가슴 통증·답답함", ja: "胸の痛み・圧迫感", ru: "Боль, сдавление в груди", fr: "Douleur ou oppression thoracique" },
            /* MOD.05 chest pain: recurring exertional pain ⇒ call 115, so moderate is urgent. */
            hints: { moderate: HINT_MODERATE_NOW },
            phrases: {
              mild: { code: "MOD01-CHEST-01-1", urgent: false, text: {
                vi: "Tôi hơi tức ngực.",
                en: "My chest feels slightly tight.",
                zh: "我有点胸闷。",
                ko: "가슴이 조금 답답해요.",
                ja: "胸が少し苦しいです。",
                ru: "У меня лёгкое чувство сдавления в груди.",
                fr: "J’ai une légère oppression dans la poitrine."
              } },
              moderate: { code: "MOD01-CHEST-01-2", urgent: true, text: {
                vi: "Tôi đau tức ngực mỗi khi gắng sức, nghỉ thì đỡ nhưng cơn đau cứ quay lại. Tôi cần cấp cứu.",
                en: "I get chest pain or tightness whenever I exert myself. It eases with rest but keeps coming back. I need emergency help.",
                zh: "我一用力胸口就疼、发闷，休息后会减轻，但一直反复发作。我需要急救。",
                ko: "힘을 쓸 때마다 가슴이 아프고 답답해요. 쉬면 나아지지만 계속 다시 아파요. 응급 치료가 필요해요.",
                ja: "体を動かすたびに胸が痛く苦しくなります。休むと楽になりますが、何度も繰り返します。緊急の治療が必要です。",
                ru: "При каждой нагрузке появляется боль или сдавление в груди; в покое проходит, но возвращается снова. Мне нужна срочная медицинская помощь.",
                fr: "J’ai une douleur ou une oppression dans la poitrine à chaque effort. Elle diminue au repos mais revient sans cesse. J’ai besoin d’une aide médicale urgente."
              } },
              severe: { code: "MOD01-CHEST-01-3", urgent: true, text: {
                vi: "Tôi đau thắt hoặc đè nặng ngực dữ dội; cơn đau có thể lan ra tay, hàm, lưng, kèm vã mồ hôi hoặc khó thở. Tôi cần cấp cứu.",
                en: "I have severe crushing or heavy chest pain. It may spread to my arm, jaw or back, and I may be sweating or short of breath. I need emergency help.",
                zh: "我胸口剧烈疼痛，像被压住或勒紧，可能放射到手臂、下巴或背部，也可能出冷汗或呼吸困难。我需要急救。",
                ko: "가슴이 조이거나 짓누르듯 심하게 아파요. 통증이 팔·턱·등으로 퍼지거나 식은땀이 나거나 숨이 찰 수도 있어요. 응급 치료가 필요해요.",
                ja: "胸が締めつけられる、または押しつぶされるように激しく痛みます。痛みが腕やあご、背中に広がったり、冷や汗や息苦しさがあったりすることもあります。緊急の治療が必要です。",
                ru: "У меня сильная давящая или сжимающая боль в груди; она может отдавать в руку, челюсть или спину, может быть пот или одышка. Мне нужна срочная медицинская помощь.",
                fr: "J’ai une douleur violente, serrante ou écrasante dans la poitrine. Elle peut irradier dans le bras, la mâchoire ou le dos, avec parfois des sueurs ou un essoufflement. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "breathing",
            icon: "wind",
            label: { vi: "Khó thở", en: "Shortness of breath", zh: "呼吸困难", ko: "숨이 참", ja: "息苦しさ", ru: "Одышка", fr: "Difficulté à respirer" },
            phrases: {
              mild: { code: "MOD01-CHEST-02-1", urgent: false, text: {
                vi: "Tôi hơi khó thở khi đi lại.",
                en: "I get a little short of breath when walking.",
                zh: "我走路时有点喘不上气。",
                ko: "걸을 때 숨이 조금 차요.",
                ja: "歩くと少し息が苦しくなります。",
                ru: "При ходьбе мне немного не хватает воздуха.",
                fr: "Je manque un peu de souffle quand je marche."
              } },
              moderate: { code: "MOD01-CHEST-02-2", urgent: false, text: {
                vi: "Tôi khó thở, thở nhanh, phải ngồi nghỉ mới đỡ.",
                en: "I am short of breath and breathing fast. It only eases when I sit and rest.",
                zh: "我呼吸困难、呼吸急促，要坐下休息才好一些。",
                ko: "숨이 차고 호흡이 빨라서 앉아서 쉬어야 조금 나아져요.",
                ja: "息苦しくて呼吸が速く、座って休まないと楽になりません。",
                ru: "Мне трудно дышать, дыхание частое, легче только сидя.",
                fr: "J’ai du mal à respirer, je respire vite et je dois m’asseoir pour aller mieux."
              } },
              severe: { code: "MOD01-CHEST-02-3", urgent: true, text: {
                vi: "Tôi rất khó thở, không nói được thành câu. Tôi cần cấp cứu.",
                en: "I can hardly breathe and cannot finish a sentence. I need emergency help.",
                zh: "我非常呼吸困难，连一句话都说不完整。我需要急救。",
                ko: "숨을 거의 쉴 수 없어서 말을 끝까지 할 수 없어요. 응급 치료가 필요해요.",
                ja: "とても息が苦しく、続けて話すことができません。緊急の治療が必要です。",
                ru: "Я почти не могу дышать и не могу договорить фразу. Мне нужна срочная медицинская помощь.",
                fr: "Je n’arrive presque plus à respirer, je ne peux pas finir une phrase. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "asthma",
            icon: "pill",
            label: { vi: "Cơn hen suyễn", en: "Asthma attack", zh: "哮喘发作", ko: "천식 발작", ja: "ぜんそく発作", ru: "Приступ астмы", fr: "Crise d’asthme" },
            phrases: {
              mild: { code: "MOD01-CHEST-03-1", urgent: false, text: {
                vi: "Tôi bị hen suyễn, đang lên cơn nhẹ, xịt thuốc thì đỡ.",
                en: "I have asthma and am having a mild attack. My inhaler helps.",
                zh: "我有哮喘，现在有轻微发作，用吸入剂后会好转。",
                ko: "천식이 있는데 지금 가벼운 발작이 있어요. 흡입기를 쓰면 나아져요.",
                ja: "ぜんそくがあり、軽い発作が起きています。吸入薬を使うと楽になります。",
                ru: "У меня астма, сейчас лёгкий приступ, ингалятор помогает.",
                fr: "Je suis asthmatique et je fais une petite crise. Mon inhalateur me soulage."
              } },
              /* MOD.05 asthma: no relief from the reliever ⇒ call 115 (severe). Relief that wears off fast ⇒ doctor today. */
              moderate: { code: "MOD01-CHEST-03-2", urgent: false, text: {
                vi: "Tôi đang lên cơn hen, xịt thuốc có đỡ nhưng chỉ được một lúc, tôi phải xịt lại nhiều lần.",
                en: "I am having an asthma attack. My inhaler helps, but only for a short time, and I keep needing it.",
                zh: "我哮喘发作了，用吸入剂会好一点，但只能维持一会儿，我得反复使用。",
                ko: "천식 발작 중이에요. 흡입기를 쓰면 잠깐 나아지지만 계속 다시 써야 해요.",
                ja: "ぜんそくの発作が起きています。吸入薬で少し楽になりますが長続きせず、何度も使わなければなりません。",
                ru: "У меня приступ астмы: ингалятор помогает ненадолго, приходится пользоваться им снова и снова.",
                fr: "Je fais une crise d’asthme. Mon inhalateur me soulage, mais pas longtemps, et je dois le reprendre souvent."
              } },
              severe: { code: "MOD01-CHEST-03-3", urgent: true, text: {
                vi: "Tôi lên cơn hen nặng: xịt thuốc không đỡ, hoặc khó thở đến mức không nói được thành câu. Tôi cần cấp cứu.",
                en: "I am having a severe asthma attack: my inhaler is not helping, or I am so breathless I cannot finish a sentence. I need emergency help.",
                zh: "我哮喘严重发作：吸入剂没有效果，或者喘得连一句话都说不完整。我需要急救。",
                ko: "심한 천식 발작이에요. 흡입기가 듣지 않거나, 숨이 차서 말을 끝까지 할 수 없어요. 응급 치료가 필요해요.",
                ja: "ひどいぜんそく発作です。吸入薬が効かないか、息が苦しくて続けて話せません。緊急の治療が必要です。",
                ru: "У меня тяжёлый приступ астмы: ингалятор не помогает или мне так трудно дышать, что я не могу договорить фразу. Мне нужна срочная медицинская помощь.",
                fr: "Je fais une grave crise d’asthme : mon inhalateur ne fait pas effet, ou j’ai tellement de mal à respirer que je ne peux pas finir une phrase. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "chest-injury",
            icon: "alert-triangle",
            label: { vi: "Va đập vùng ngực", en: "Chest injury", zh: "胸部撞伤", ko: "가슴 부상", ja: "胸のけが", ru: "Травма груди", fr: "Choc à la poitrine" },
            phrases: {
              mild: { code: "MOD01-CHEST-04-1", urgent: false, text: {
                vi: "Tôi bị va vào ngực, hơi đau.",
                en: "I hit my chest and it hurts a little.",
                zh: "我胸口被撞了一下，有点疼。",
                ko: "가슴을 부딪쳐서 조금 아파요.",
                ja: "胸をぶつけて、少し痛いです。",
                ru: "У меня ушиб груди, болит несильно.",
                fr: "Je me suis cogné la poitrine, j’ai un peu mal."
              } },
              moderate: { code: "MOD01-CHEST-04-2", urgent: false, text: {
                vi: "Tôi bị va vào ngực, đau nhiều khi hít sâu, ho hoặc cử động.",
                en: "I hit my chest. It hurts a lot when I breathe deeply, cough or move.",
                zh: "我胸口被撞了，深呼吸、咳嗽或活动时很疼。",
                ko: "가슴을 부딪쳤는데 숨을 깊이 쉬거나 기침하거나 움직이면 많이 아파요.",
                ja: "胸をぶつけました。深呼吸や咳をしたり、動いたりするととても痛みます。",
                ru: "У меня ушиб груди: сильно болит при глубоком вдохе, кашле и движении.",
                fr: "Je me suis cogné la poitrine. J’ai très mal quand je respire fort, que je tousse ou que je bouge."
              } },
              severe: { code: "MOD01-CHEST-04-3", urgent: true, text: {
                vi: "Tôi bị va đập mạnh vào ngực, giờ ngày càng khó thở hoặc ho ra máu. Tôi cần cấp cứu.",
                en: "I took a hard blow to my chest, and now breathing is getting harder or I am coughing up blood. I need emergency help.",
                zh: "我胸部受到重击，现在呼吸越来越困难，或者咳出了血。我需要急救。",
                ko: "가슴을 세게 부딪쳤는데 숨쉬기가 점점 힘들어지거나 기침할 때 피가 나와요. 응급 치료가 필요해요.",
                ja: "胸を強く打ち、だんだん息が苦しくなっているか、せきで血が出ます。緊急の治療が必要です。",
                ru: "Сильный удар в грудь: дышать становится всё труднее или появился кашель с кровью. Мне нужна срочная медицинская помощь.",
                fr: "J’ai reçu un choc violent à la poitrine et, depuis, j’ai de plus en plus de mal à respirer ou je crache du sang. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "palpitations",
            icon: "activity",
            label: { vi: "Tim đập nhanh, hồi hộp", en: "Racing heartbeat", zh: "心跳快、心慌", ko: "심장 두근거림", ja: "動悸", ru: "Учащённое сердцебиение", fr: "Palpitations" },
            phrases: {
              mild: { code: "MOD01-CHEST-05-1", urgent: false, text: {
                vi: "Tôi thấy tim đập nhanh, hồi hộp.",
                en: "I can feel my heart racing.",
                zh: "我感觉心跳很快、心慌。",
                ko: "심장이 빨리 뛰고 두근거려요.",
                ja: "動悸がして、心臓がどきどきします。",
                ru: "У меня учащённое сердцебиение.",
                fr: "J’ai des palpitations, mon cœur bat vite."
              } },
              moderate: { code: "MOD01-CHEST-05-2", urgent: false, text: {
                vi: "Tim tôi đập nhanh và không đều, kèm chóng mặt.",
                en: "My heart is beating fast and irregularly, and I feel dizzy.",
                zh: "我心跳又快又不规律，还头晕。",
                ko: "심장이 빠르고 불규칙하게 뛰고 어지러워요.",
                ja: "心臓が速く不規則に打っていて、めまいがします。",
                ru: "Сердце бьётся часто и неровно, кружится голова.",
                fr: "Mon cœur bat vite et de façon irrégulière, et j’ai des vertiges."
              } },
              severe: { code: "MOD01-CHEST-05-3", urgent: true, text: {
                vi: "Tim tôi đập rất nhanh, kèm đau ngực, khó thở hoặc cảm giác sắp ngất. Tôi cần cấp cứu.",
                en: "My heart is racing, with chest pain, trouble breathing or a feeling that I am about to faint. I need emergency help.",
                zh: "我心跳非常快，同时胸痛、呼吸困难，或者感觉快要晕倒。我需要急救。",
                ko: "심장이 매우 빨리 뛰면서 가슴이 아프거나, 숨이 차거나, 곧 쓰러질 것 같아요. 응급 치료가 필요해요.",
                ja: "心臓がとても速く打っていて、胸の痛み、息苦しさ、または今にも倒れそうな感じがあります。緊急の治療が必要です。",
                ru: "Сердце бьётся очень часто, и при этом болит в груди, трудно дышать или я вот-вот потеряю сознание. Мне нужна срочная медицинская помощь.",
                fr: "Mon cœur bat très vite, avec une douleur dans la poitrine, du mal à respirer ou l’impression que je vais m’évanouir. J’ai besoin d’une aide médicale urgente."
              } }
            }
          }
        ]
      },

      /* ═════════════════════════════ 3. BỤNG / ABDOMEN ═════════════════════════════ */
      {
        id: "abdomen",
        icon: "abdomen",
        label: { vi: "Bụng", en: "Abdomen", zh: "腹部", ko: "배", ja: "お腹", ru: "Живот", fr: "Ventre" },
        symptoms: [
          {
            id: "abd-pain",
            icon: "target",
            label: { vi: "Đau bụng", en: "Abdominal pain", zh: "腹痛", ko: "복통", ja: "腹痛", ru: "Боль в животе", fr: "Douleur au ventre" },
            children: [
              {
                id: "abd-pain-upper",
                label: { vi: "Bụng trên (trên rốn)", en: "Upper belly (above the navel)", zh: "上腹部（肚脐以上）", ko: "윗배(배꼽 위)", ja: "上腹部（へそより上）", ru: "Верх живота (выше пупка)", fr: "Haut du ventre (au-dessus du nombril)" },
                phrases: {
                  mild: { code: "MOD01-ABD-01-1", urgent: false, text: {
                    vi: "Tôi đau nhẹ ở bụng trên.",
                    en: "I have mild pain in my upper belly.",
                    zh: "我上腹部有点疼。",
                    ko: "윗배가 조금 아파요.",
                    ja: "上腹部が少し痛いです。",
                    ru: "У меня несильная боль в верхней части живота.",
                    fr: "J’ai une légère douleur dans le haut du ventre."
                  } },
                  moderate: { code: "MOD01-ABD-01-2", urgent: false, text: {
                    vi: "Tôi đau nhiều ở bụng trên, kèm buồn nôn.",
                    en: "I have a lot of pain in my upper belly, with nausea.",
                    zh: "我上腹部很疼，还恶心。",
                    ko: "윗배가 많이 아프고 메스꺼워요.",
                    ja: "上腹部がかなり痛く、吐き気もあります。",
                    ru: "У меня сильная боль в верхней части живота и тошнота.",
                    fr: "J’ai très mal dans le haut du ventre, avec des nausées."
                  } },
                  severe: { code: "MOD01-ABD-01-3", urgent: true, text: {
                    vi: "Tôi đau dữ dội ở bụng trên, có thể lan ra sau lưng. Tôi cần cấp cứu.",
                    en: "I have severe pain in my upper belly, which may spread to my back. I need emergency help.",
                    zh: "我上腹部剧烈疼痛，可能放射到背部。我需要急救。",
                    ko: "윗배가 심하게 아프고, 통증이 등까지 퍼질 수도 있어요. 응급 치료가 필요해요.",
                    ja: "上腹部が激しく痛みます。痛みが背中まで広がることもあります。緊急の治療が必要です。",
                    ru: "У меня сильная боль в верхней части живота, может отдавать в спину. Мне нужна срочная медицинская помощь.",
                    fr: "J’ai une douleur violente dans le haut du ventre, qui peut irradier dans le dos. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              },
              {
                id: "abd-pain-lower",
                label: { vi: "Bụng dưới (dưới rốn)", en: "Lower belly (below the navel)", zh: "下腹部（肚脐以下）", ko: "아랫배(배꼽 아래)", ja: "下腹部（へそより下）", ru: "Низ живота (ниже пупка)", fr: "Bas du ventre (sous le nombril)" },
                phrases: {
                  mild: { code: "MOD01-ABD-02-1", urgent: false, text: {
                    vi: "Tôi đau nhẹ ở bụng dưới.",
                    en: "I have mild pain in my lower belly.",
                    zh: "我下腹部有点疼。",
                    ko: "아랫배가 조금 아파요.",
                    ja: "下腹部が少し痛いです。",
                    ru: "У меня несильная боль внизу живота.",
                    fr: "J’ai une légère douleur dans le bas du ventre."
                  } },
                  moderate: { code: "MOD01-ABD-02-2", urgent: false, text: {
                    vi: "Tôi đau nhiều ở bụng dưới, đau tăng khi đi lại.",
                    en: "I have a lot of pain in my lower belly, and it gets worse when I walk.",
                    zh: "我下腹部很疼，走路时更疼。",
                    ko: "아랫배가 많이 아프고 걸으면 더 아파요.",
                    ja: "下腹部がかなり痛く、歩くと痛みが強くなります。",
                    ru: "У меня сильная боль внизу живота, при ходьбе хуже.",
                    fr: "J’ai très mal dans le bas du ventre, surtout quand je marche."
                  } },
                  severe: { code: "MOD01-ABD-02-3", urgent: true, text: {
                    vi: "Tôi đau dữ dội ở bụng dưới, không đứng thẳng được hoặc bụng cứng lại. Tôi cần cấp cứu.",
                    en: "I have severe pain in my lower belly: I cannot stand up straight, or my belly has gone hard. I need emergency help.",
                    zh: "我下腹部剧烈疼痛，直不起身，或者肚子发硬。我需要急救。",
                    ko: "아랫배가 심하게 아파서 똑바로 설 수 없거나, 배가 딱딱해졌어요. 응급 치료가 필요해요.",
                    ja: "下腹部が激しく痛み、まっすぐ立てないか、お腹が硬くなっています。緊急の治療が必要です。",
                    ru: "У меня сильная боль внизу живота: не могу выпрямиться или живот стал твёрдым. Мне нужна срочная медицинская помощь.",
                    fr: "J’ai une douleur violente dans le bas du ventre\u00a0: je n’arrive pas à me redresser, ou mon ventre est devenu dur. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              },
              {
                id: "abd-pain-all",
                label: { vi: "Khắp bụng", en: "All over the belly", zh: "整个腹部", ko: "배 전체", ja: "お腹全体", ru: "По всему животу", fr: "Dans tout le ventre" },
                phrases: {
                  mild: { code: "MOD01-ABD-03-1", urgent: false, text: {
                    vi: "Tôi đau âm ỉ khắp bụng.",
                    en: "I have a dull ache all over my belly.",
                    zh: "我整个肚子隐隐作痛。",
                    ko: "배 전체가 은근히 아파요.",
                    ja: "お腹全体がしくしく痛みます。",
                    ru: "У меня ноющая боль по всему животу.",
                    fr: "J’ai une douleur sourde dans tout le ventre."
                  } },
                  moderate: { code: "MOD01-ABD-03-2", urgent: false, text: {
                    vi: "Tôi đau quặn từng cơn khắp bụng, đau nhiều hơn trong vài giờ qua.",
                    en: "I have cramping pain all over my belly that has got worse over the last few hours.",
                    zh: "我整个肚子一阵阵绞痛，这几个小时越来越厉害。",
                    ko: "배 전체가 쥐어짜듯 주기적으로 아프고, 몇 시간 동안 점점 심해졌어요.",
                    ja: "お腹全体が差し込むように繰り返し痛み、この数時間で悪化しています。",
                    ru: "У меня схваткообразная боль по всему животу, за последние часы стало хуже.",
                    fr: "J’ai des crampes dans tout le ventre, de plus en plus fortes depuis quelques heures."
                  } },
                  severe: { code: "MOD01-ABD-03-3", urgent: true, text: {
                    vi: "Tôi đau dữ dội khắp bụng, bụng chướng hoặc cứng. Tôi cần cấp cứu.",
                    en: "I have severe pain all over my belly, and it is swollen or hard. I need emergency help.",
                    zh: "我整个肚子剧烈疼痛，腹部发胀或发硬。我需要急救。",
                    ko: "배 전체가 심하게 아프고 배가 부풀거나 딱딱해요. 응급 치료가 필요해요.",
                    ja: "お腹全体が激しく痛み、お腹が張っているか硬くなっています。緊急の治療が必要です。",
                    ru: "У меня сильная боль по всему животу, живот вздут или твёрдый. Мне нужна срочная медицинская помощь.",
                    fr: "J’ai une douleur violente dans tout le ventre, il est gonflé ou dur. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              }
            ]
          },
          {
            id: "diarrhea",
            icon: "waves",
            label: { vi: "Tiêu chảy", en: "Diarrhea", zh: "腹泻", ko: "설사", ja: "下痢", ru: "Диарея", fr: "Diarrhée" },
            phrases: {
              mild: { code: "MOD01-ABD-04-1", urgent: false, text: {
                vi: "Tôi bị tiêu chảy nhẹ, đi ngoài vài lần trong ngày.",
                en: "I have mild diarrhea, a few times today.",
                zh: "我有轻微腹泻，今天拉了几次。",
                ko: "가벼운 설사가 있어요. 오늘 몇 번 했어요.",
                ja: "軽い下痢で、今日は何回かトイレに行きました。",
                ru: "У меня лёгкая диарея, сегодня несколько раз.",
                fr: "J’ai une petite diarrhée, quelques fois aujourd’hui."
              } },
              moderate: { code: "MOD01-ABD-04-2", urgent: false, text: {
                vi: "Tôi tiêu chảy nhiều lần, đau quặn bụng, mệt và rất khát.",
                en: "I have had diarrhea many times, with cramping belly pain. I feel weak and very thirsty.",
                zh: "我腹泻了很多次，肚子绞痛，很累，非常口渴。",
                ko: "설사를 여러 번 했고 배가 쥐어짜듯 아프며 기운이 없고 매우 목말라요.",
                ja: "何度も下痢をしていて、お腹が差し込むように痛み、だるくて、とても喉が渇きます。",
                ru: "У меня частая диарея, спазмы в животе, слабость и сильная жажда.",
                fr: "J’ai eu la diarrhée à de nombreuses reprises, avec des crampes au ventre. Je me sens faible et j’ai très soif."
              } },
              severe: { code: "MOD01-ABD-04-3", urgent: true, text: {
                vi: "Tôi tiêu chảy liên tục, người lả đi hoặc chóng mặt khi đứng dậy. Tôi cần cấp cứu.",
                en: "I have constant diarrhea, and I feel very weak or dizzy when I stand up. I need emergency help.",
                zh: "我一直在腹泻，全身无力，或者站起来就头晕。我需要急救。",
                ko: "설사가 멈추지 않고, 기운이 하나도 없거나 일어서면 어지러워요. 응급 치료가 필요해요.",
                ja: "下痢が止まらず、ぐったりしているか、立ち上がるとめまいがします。緊急の治療が必要です。",
                ru: "У меня непрекращающаяся диарея, сильная слабость или головокружение, когда встаю. Мне нужна срочная медицинская помощь.",
                fr: "J’ai une diarrhée continue, et je me sens très faible ou j’ai des vertiges en me levant. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "vomiting",
            icon: "alert-circle",
            label: { vi: "Buồn nôn, nôn", en: "Nausea, vomiting", zh: "恶心、呕吐", ko: "메스꺼움·구토", ja: "吐き気・嘔吐", ru: "Тошнота, рвота", fr: "Nausées, vomissements" },
            phrases: {
              mild: { code: "MOD01-ABD-05-1", urgent: false, text: {
                vi: "Tôi thấy buồn nôn.",
                en: "I feel nauseous.",
                zh: "我觉得恶心。",
                ko: "속이 메스꺼워요.",
                ja: "吐き気がします。",
                ru: "Меня тошнит.",
                fr: "J’ai la nausée."
              } },
              /* MOD.05 dehydration: "cannot drink" ⇒ call 115, so the non-urgent level still keeps sips down. */
              moderate: { code: "MOD01-ABD-05-2", urgent: false, text: {
                vi: "Tôi nôn nhiều lần, ăn uống kém nhưng vẫn uống được từng ngụm nước.",
                en: "I have vomited several times and can hardly eat, but I can keep down small sips of water.",
                zh: "我吐了好几次，吃不下东西，但还能小口喝水。",
                ko: "여러 번 토했고 거의 먹지 못하지만, 물은 조금씩 마실 수 있어요.",
                ja: "何度も吐いて、ほとんど食べられませんが、水は少しずつ飲めます。",
                ru: "У меня была рвота несколько раз, почти не могу есть, но небольшие глотки воды удерживаются.",
                fr: "J’ai vomi plusieurs fois et j’arrive à peine à manger, mais je garde de petites gorgées d’eau."
              } },
              severe: { code: "MOD01-ABD-05-3", urgent: true, text: {
                vi: "Tôi nôn liên tục, uống nước vào là nôn ra, hoặc nôn ra máu. Tôi cần cấp cứu.",
                en: "I cannot stop vomiting and even water comes straight back up, or I am vomiting blood. I need emergency help.",
                zh: "我不停地呕吐，连喝水都会吐出来，或者吐出了血。我需要急救。",
                ko: "계속 토하고 물만 마셔도 토하거나, 피를 토해요. 응급 치료가 필요해요.",
                ja: "嘔吐が止まらず水を飲んでも吐いてしまうか、血を吐いています。緊急の治療が必要です。",
                ru: "У меня непрекращающаяся рвота, даже вода не удерживается, или рвота с кровью. Мне нужна срочная медицинская помощь.",
                fr: "Je vomis sans arrêt et je ne garde même pas l’eau, ou je vomis du sang. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "abd-injury",
            icon: "alert-triangle",
            label: { vi: "Va đập vùng bụng", en: "Abdominal injury", zh: "腹部撞伤", ko: "배 부상", ja: "お腹のけが", ru: "Травма живота", fr: "Choc au ventre" },
            phrases: {
              mild: { code: "MOD01-ABD-06-1", urgent: false, text: {
                vi: "Tôi bị va vào bụng, hơi đau.",
                en: "I hit my belly and it hurts a little.",
                zh: "我肚子被撞了一下，有点疼。",
                ko: "배를 부딪쳐서 조금 아파요.",
                ja: "お腹をぶつけて、少し痛いです。",
                ru: "У меня ушиб живота, болит несильно.",
                fr: "Je me suis cogné le ventre, j’ai un peu mal."
              } },
              moderate: { code: "MOD01-ABD-06-2", urgent: false, text: {
                vi: "Tôi bị va vào bụng, đau ngày càng tăng.",
                en: "I hit my belly and the pain is getting worse.",
                zh: "我肚子被撞了，疼痛越来越厉害。",
                ko: "배를 부딪쳤는데 통증이 점점 심해져요.",
                ja: "お腹をぶつけて、痛みがだんだん強くなっています。",
                ru: "У меня ушиб живота, боль усиливается.",
                fr: "Je me suis cogné le ventre et la douleur augmente."
              } },
              severe: { code: "MOD01-ABD-06-3", urgent: true, text: {
                vi: "Tôi bị va đập mạnh vào bụng, giờ đau dữ dội, hoặc choáng váng, vã mồ hôi. Tôi cần cấp cứu.",
                en: "I took a hard blow to my belly, and now I have severe pain, or I feel faint and sweaty. I need emergency help.",
                zh: "我腹部受到重击，现在剧烈疼痛，或者头晕眼花、出冷汗。我需要急救。",
                ko: "배를 세게 부딪쳤는데 심하게 아프거나, 어지럽고 식은땀이 나요. 응급 치료가 필요해요.",
                ja: "お腹を強く打ち、激しく痛むか、ふらふらして冷や汗が出ています。緊急の治療が必要です。",
                ru: "Сильный удар в живот: резкая боль или дурнота и холодный пот. Мне нужна срочная медицинская помощь.",
                fr: "J’ai reçu un choc violent au ventre\u00a0: j’ai très mal, ou j’ai l’impression que je vais m’évanouir et je transpire. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            /* Added in 1.1.0-demo (appended, so no code was renumbered). Methanol in fake/home-made liquor, wild
               mushrooms and pesticides can kill with delayed symptoms: MOD.05 "poisoning" says go to hospital on
               suspicion, so every level is urgent (as for snakebite). */
            id: "poisoning",
            icon: "bottle",
            label: { vi: "Ngộ độc (rượu, nấm, hoá chất)", en: "Poisoning (alcohol, mushrooms, chemicals)", zh: "中毒（酒、蘑菇、化学品）", ko: "중독(술·버섯·화학물질)", ja: "中毒（酒・キノコ・化学物質）", ru: "Отравление (алкоголь, грибы, химикаты)", fr: "Intoxication (alcool, champignons, produits chimiques)" },
            labels: {
              mild: LABEL_NO_SYMPTOMS,
              moderate: { vi: "Nôn, đau bụng", en: "Vomiting, belly pain", zh: "呕吐、腹痛", ko: "구토·복통", ja: "吐き気・腹痛", ru: "Рвота, боль в животе", fr: "Vomissements, mal au ventre" },
              severe: { vi: "Nhìn mờ, khó thở, lơ mơ", en: "Blurred vision, breathing trouble, drowsy", zh: "视力模糊、呼吸困难、昏沉", ko: "시야 흐림·호흡곤란·몽롱함", ja: "目のかすみ・息苦しさ・意識低下", ru: "Нечёткое зрение, одышка, сонливость", fr: "Vue trouble, souffle court, somnolence" }
            },
            hints: {
              mild: { vi: "Vẫn phải đến viện ngay — triệu chứng có thể xuất hiện muộn", en: "Still go to hospital now — symptoms can start hours later", zh: "仍须马上去医院——症状可能几个小时后才出现", ko: "그래도 바로 병원에 가야 해요 — 증상은 몇 시간 뒤에 나타날 수 있어요", ja: "すぐ病院へ — 症状は数時間後に出ることがある", ru: "Всё равно срочно в больницу — симптомы могут появиться через несколько часов", fr: "Aller à l’hôpital tout de suite — les symptômes peuvent apparaître des heures plus tard" },
              moderate: { vi: "Nôn, đau bụng hoặc tiêu chảy sau khi ăn uống", en: "Vomiting, belly pain or diarrhea after eating or drinking", zh: "吃喝之后呕吐、腹痛或腹泻", ko: "먹거나 마신 뒤 구토·복통·설사", ja: "飲食のあとに嘔吐・腹痛・下痢", ru: "Рвота, боль в животе или диарея после еды или питья", fr: "Vomissements, mal au ventre ou diarrhée après avoir mangé ou bu" },
              severe: { vi: "Nhìn mờ, khó thở, co giật hoặc lơ mơ", en: "Blurred vision, trouble breathing, seizures or drowsiness", zh: "视力模糊、呼吸困难、抽搐或昏沉", ko: "시야 흐림, 호흡곤란, 경련 또는 몽롱함", ja: "目のかすみ、息苦しさ、けいれん、または意識低下", ru: "Нечёткое зрение, одышка, судороги или сонливость", fr: "Vue trouble, difficultés à respirer, convulsions ou somnolence" }
            },
            phrases: {
              mild: { code: "MOD01-ABD-07-1", urgent: true, text: {
                vi: "Tôi đã ăn hoặc uống thứ nghi có độc (rượu không rõ nguồn gốc, nấm rừng hoặc hoá chất). Tôi chưa có triệu chứng nhưng cần đến bệnh viện ngay.",
                en: "I have eaten or drunk something that may be poisonous (alcohol of unknown origin, wild mushrooms or a chemical). I have no symptoms yet, but I need to get to a hospital now.",
                zh: "我吃了或喝了可能有毒的东西（来路不明的酒、野生蘑菇或化学品）。我还没有症状，但需要马上去医院。",
                ko: "독이 있을 수 있는 것을 먹거나 마셨어요(출처를 모르는 술, 야생 버섯 또는 화학물질). 아직 증상은 없지만 지금 바로 병원에 가야 해요.",
                ja: "毒があるかもしれないものを食べたか飲みました（出どころのわからない酒、野生のキノコ、化学物質など）。まだ症状はありませんが、すぐに病院へ行く必要があります。",
                ru: "Есть подозрение на отравление: алкоголь неизвестного происхождения, лесные грибы или химикат. Симптомов пока нет, но мне нужно срочно в больницу.",
                fr: "J’ai mangé ou bu quelque chose qui pourrait être toxique (alcool d’origine inconnue, champignons sauvages ou produit chimique). Je n’ai pas encore de symptômes, mais je dois aller à l’hôpital tout de suite."
              } },
              moderate: { code: "MOD01-ABD-07-2", urgent: true, text: {
                vi: "Tôi nghi bị ngộ độc sau khi ăn nấm, uống rượu hoặc tiếp xúc hoá chất: tôi nôn, đau bụng hoặc tiêu chảy. Tôi cần cấp cứu.",
                en: "I think I have been poisoned by mushrooms, alcohol or a chemical: I am vomiting or have belly pain or diarrhea. I need emergency help.",
                zh: "我吃了蘑菇、喝了酒或接触了化学品后可能中毒了：呕吐、肚子疼或腹泻。我需要急救。",
                ko: "버섯을 먹거나 술을 마시거나 화학물질에 노출된 뒤 중독된 것 같아요. 토하거나 배가 아프거나 설사를 해요. 응급 치료가 필요해요.",
                ja: "キノコやお酒、化学物質で中毒になったかもしれません。吐いたり、お腹が痛かったり、下痢をしたりしています。緊急の治療が必要です。",
                ru: "Подозреваю отравление грибами, алкоголем или химикатом: рвота, боль в животе или диарея. Мне нужна срочная медицинская помощь.",
                fr: "Je crains une intoxication par des champignons, de l’alcool ou un produit chimique\u00a0: je vomis, j’ai mal au ventre ou la diarrhée. J’ai besoin d’une aide médicale urgente."
              } },
              severe: { code: "MOD01-ABD-07-3", urgent: true, text: {
                vi: "Tôi nghi bị ngộ độc và đang nhìn mờ, khó thở, co giật hoặc lơ mơ. Tôi cần cấp cứu.",
                en: "I think I have been poisoned, and now my vision is blurred, I have trouble breathing, I am having seizures or I feel very drowsy. I need emergency help.",
                zh: "我可能中毒了，现在视力模糊、呼吸困难、抽搐或昏昏沉沉。我需要急救。",
                ko: "중독된 것 같은데 앞이 흐릿하거나, 숨쉬기 힘들거나, 경련이 있거나, 정신이 몽롱해요. 응급 치료가 필요해요.",
                ja: "中毒したかもしれません。目がかすむ、息が苦しい、けいれんがある、または意識がぼんやりしています。緊急の治療が必要です。",
                ru: "Подозреваю отравление: зрение затуманено, трудно дышать, судороги или сильная сонливость. Мне нужна срочная медицинская помощь.",
                fr: "Je crains une intoxication et j’ai la vue trouble, du mal à respirer, des convulsions ou une forte somnolence. J’ai besoin d’une aide médicale urgente."
              } }
            }
          }
        ]
      },

      /* ═════════════════════════════ 4. TAY / ARMS & HANDS ═════════════════════════════ */
      {
        id: "arms",
        icon: "hand",
        label: { vi: "Tay", en: "Arms & hands", zh: "手臂和手", ko: "팔·손", ja: "腕・手", ru: "Руки", fr: "Bras et mains" },
        symptoms: [
          {
            id: "arm-injury",
            icon: "bone",
            label: { vi: "Chấn thương tay", en: "Arm or hand injury", zh: "手臂或手受伤", ko: "팔·손 부상", ja: "腕・手のけが", ru: "Травма руки", fr: "Blessure au bras ou à la main" },
            children: [
              {
                id: "arm-fracture",
                label: { vi: "Nghi gãy xương", en: "Possible broken bone", zh: "可能骨折", ko: "골절 의심", ja: "骨折の疑い", ru: "Возможен перелом", fr: "Fracture possible" },
                phrases: {
                  mild: { code: "MOD01-ARM-01-1", urgent: false, text: {
                    vi: "Tay tôi đau và hơi sưng sau khi ngã, vẫn cử động được.",
                    en: "My arm hurts and is a little swollen after a fall, but I can still move it.",
                    zh: "我摔倒后手臂疼，有点肿，但还能活动。",
                    ko: "넘어진 뒤 팔이 아프고 조금 부었지만 움직일 수는 있어요.",
                    ja: "転んだあと腕が痛く、少し腫れていますが、動かすことはできます。",
                    ru: "После падения рука болит и немного опухла, но я могу ею двигать.",
                    fr: "Après une chute, j’ai mal au bras et il est un peu enflé, mais je peux le bouger."
                  } },
                  moderate: { code: "MOD01-ARM-01-2", urgent: false, text: {
                    vi: "Tay tôi sưng to, rất đau khi cử động và gần như không dùng được.",
                    en: "My arm is very swollen, it hurts a lot to move it, and I can hardly use it.",
                    zh: "我的手臂肿得很厉害，一动就很疼，几乎用不了。",
                    ko: "팔이 많이 붓고 움직이면 매우 아파서 거의 쓸 수 없어요.",
                    ja: "腕がひどく腫れて、動かすととても痛く、ほとんど使えません。",
                    ru: "Рука сильно опухла, двигать ею очень больно, я почти не могу ею пользоваться.",
                    fr: "Mon bras est très enflé, j’ai très mal quand je le bouge et j’arrive à peine à m’en servir."
                  } },
                  severe: { code: "MOD01-ARM-01-3", urgent: true, text: {
                    vi: "Tay tôi bị biến dạng hoặc lộ xương ra ngoài. Tôi cần cấp cứu.",
                    en: "My arm is deformed or the bone is showing. I need emergency help.",
                    zh: "我的手臂变形了，或者骨头露出来了。我需要急救。",
                    ko: "팔이 변형됐거나 뼈가 드러나 보여요. 응급 치료가 필요해요.",
                    ja: "腕が変形しているか、骨が見えています。緊急の治療が必要です。",
                    ru: "Рука деформирована или видна кость. Мне нужна срочная медицинская помощь.",
                    fr: "Mon bras est déformé ou l’os est visible. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              },
              {
                id: "arm-sprain",
                label: { vi: "Bong gân, trẹo cổ tay", en: "Sprained wrist", zh: "手腕扭伤", ko: "손목 삠", ja: "手首のねんざ", ru: "Растяжение запястья", fr: "Entorse du poignet" },
                phrases: {
                  mild: { code: "MOD01-ARM-02-1", urgent: false, text: {
                    vi: "Tôi bị trẹo cổ tay, hơi đau.",
                    en: "I twisted my wrist and it hurts a little.",
                    zh: "我扭到了手腕，有点疼。",
                    ko: "손목을 삐어서 조금 아파요.",
                    ja: "手首をひねって、少し痛いです。",
                    ru: "Подвернулось запястье, немного болит.",
                    fr: "Je me suis tordu le poignet, j’ai un peu mal."
                  } },
                  moderate: { code: "MOD01-ARM-02-2", urgent: false, text: {
                    vi: "Cổ tay tôi bị trẹo, sưng và đau khi cử động.",
                    en: "I twisted my wrist. It is swollen and hurts when I move it.",
                    zh: "我手腕扭伤了，肿了，活动时疼。",
                    ko: "손목을 삐었는데 붓고 움직이면 아파요.",
                    ja: "手首をひねって腫れていて、動かすと痛みます。",
                    ru: "Запястье опухло и болит при движении.",
                    fr: "Je me suis tordu le poignet, il est enflé et me fait mal quand je bouge."
                  } },
                  severe: { code: "MOD01-ARM-02-3", urgent: false, text: {
                    vi: "Cổ tay tôi sưng to, bầm tím nhiều hoặc không cử động được. Tôi cần được khám ngay.",
                    en: "My wrist is badly swollen and bruised, or I cannot move it. I need to see a doctor right away.",
                    zh: "我的手腕肿得很厉害、发青发紫，或者不能活动。我需要马上看医生。",
                    ko: "손목이 많이 붓고 멍이 들었거나, 움직일 수 없어요. 바로 진료를 받아야 해요.",
                    ja: "手首がひどく腫れて青あざになっているか、動かせません。すぐに診察が必要です。",
                    ru: "Запястье сильно опухло и посинело или не двигается. Мне нужно срочно к врачу.",
                    fr: "Mon poignet est très enflé, avec un gros hématome, ou je ne peux plus le bouger. J’ai besoin de voir un médecin tout de suite."
                  } }
                }
              },
              {
                id: "arm-dislocation",
                label: { vi: "Trật khớp (vai, khuỷu, ngón)", en: "Dislocated joint (shoulder, elbow, finger)", zh: "关节脱位（肩、肘、手指）", ko: "관절 탈구(어깨·팔꿈치·손가락)", ja: "脱臼（肩・ひじ・指）", ru: "Вывих (плечо, локоть, палец)", fr: "Luxation (épaule, coude, doigt)" },
                phrases: {
                  mild: { code: "MOD01-ARM-03-1", urgent: false, text: {
                    vi: "Khớp tay tôi đau sau cú ngã, cử động hơi khó.",
                    en: "A joint in my arm hurts after a fall and is a little hard to move.",
                    zh: "我摔倒后手臂的关节疼，活动有点困难。",
                    ko: "넘어진 뒤 팔 관절이 아프고 움직이기가 조금 힘들어요.",
                    ja: "転んだあと腕の関節が痛み、少し動かしにくいです。",
                    ru: "После падения болит сустав руки, двигать немного трудно.",
                    fr: "Après une chute, j’ai mal à une articulation du bras et j’ai un peu de mal à la bouger."
                  } },
                  moderate: { code: "MOD01-ARM-03-2", urgent: false, text: {
                    vi: "Khớp tay tôi rất đau, trông lệch so với bên kia.",
                    en: "The joint is very painful and looks out of place compared with the other side.",
                    zh: "我手臂的关节很疼，和另一侧相比看起来错位了。",
                    ko: "관절이 매우 아프고 반대쪽과 비교해 어긋나 보여요.",
                    ja: "関節がとても痛く、反対側と比べてずれているように見えます。",
                    ru: "Сустав очень болит и выглядит смещённым по сравнению с другой стороной.",
                    fr: "L’articulation me fait très mal et semble déplacée par rapport à l’autre côté."
                  } },
                  severe: { code: "MOD01-ARM-03-3", urgent: true, text: {
                    vi: "Khớp tay tôi bị lệch hẳn, và bàn tay tê, lạnh hoặc tím đi. Tôi cần cấp cứu.",
                    en: "The joint is clearly out of place, and my hand is numb, cold or turning blue. I need emergency help.",
                    zh: "我手臂的关节明显错位，手发麻、发冷或发紫。我需要急救。",
                    ko: "관절이 완전히 빠졌고 손이 저리거나 차갑거나 파래졌어요. 응급 치료가 필요해요.",
                    ja: "関節が明らかに外れていて、手がしびれているか、冷たいか、紫色になっています。緊急の治療が必要です。",
                    ru: "Сустав явно выбит, а кисть онемела, похолодела или посинела. Мне нужна срочная медицинская помощь.",
                    fr: "L’articulation est complètement déboîtée, et ma main est engourdie, froide ou bleue. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              }
            ]
          },
          {
            id: "arm-wound",
            icon: "bandage",
            label: { vi: "Vết cắt, chảy máu", en: "Cut or bleeding", zh: "割伤、出血", ko: "베인 상처·출혈", ja: "切り傷・出血", ru: "Порез, кровотечение", fr: "Coupure, saignement" },
            phrases: {
              mild: { code: "MOD01-ARM-04-1", urgent: false, text: {
                vi: "Tay tôi bị một vết đứt nhỏ, chảy ít máu.",
                en: "I have a small cut on my hand or arm, bleeding a little.",
                zh: "我的手或手臂有一个小伤口，出了一点血。",
                ko: "손이나 팔을 조금 베여서 피가 조금 나요.",
                ja: "手や腕を少し切って、少し出血しています。",
                ru: "У меня небольшой порез на руке, немного кровит.",
                fr: "J’ai une petite coupure au bras ou à la main, qui saigne un peu."
              } },
              moderate: { code: "MOD01-ARM-04-2", urgent: false, text: {
                vi: "Tay tôi có vết cắt sâu, đã ép chặt một lúc nhưng vẫn chảy máu.",
                en: "I have a deep cut on my hand or arm. It is still bleeding after pressing on it for a while.",
                zh: "我的手或手臂有一道很深的伤口，按压了一会儿仍在出血。",
                ko: "손이나 팔에 깊이 베인 상처가 있는데, 한동안 눌러도 계속 피가 나요.",
                ja: "手や腕に深い切り傷があり、しばらく押さえても出血が続いています。",
                ru: "У меня глубокий порез на руке, после прижатия кровь всё ещё идёт.",
                fr: "J’ai une coupure profonde au bras ou à la main, qui saigne encore malgré la compression."
              } },
              severe: { code: "MOD01-ARM-04-3", urgent: true, text: {
                vi: "Tay tôi chảy máu rất nhiều hoặc máu phun thành tia. Tôi cần cấp cứu.",
                en: "My hand or arm is bleeding heavily, or the blood is spurting. I need emergency help.",
                zh: "我的手或手臂大量出血，或者血往外喷。我需要急救。",
                ko: "손이나 팔에서 피가 많이 나거나 피가 뿜어져 나와요. 응급 치료가 필요해요.",
                ja: "手や腕から大量に出血しているか、血が噴き出しています。緊急の治療が必要です。",
                ru: "У меня сильное кровотечение из руки, или кровь бьёт струёй. Мне нужна срочная медицинская помощь.",
                fr: "Mon bras ou ma main saigne abondamment, ou le sang gicle. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "arm-burn",
            icon: "flame",
            label: { vi: "Bỏng ở tay", en: "Burn on hand or arm", zh: "手或手臂烧烫伤", ko: "손·팔 화상", ja: "手・腕のやけど", ru: "Ожог руки", fr: "Brûlure au bras ou à la main" },
            phrases: {
              mild: { code: "MOD01-ARM-05-1", urgent: false, text: {
                vi: "Tay tôi bị bỏng nhẹ, da đỏ và rát.",
                en: "I have a minor burn on my hand or arm. The skin is red and stinging.",
                zh: "我的手或手臂轻度烧烫伤，皮肤发红，火辣辣地疼。",
                ko: "손이나 팔에 가벼운 화상을 입었어요. 피부가 빨갛고 따가워요.",
                ja: "手や腕に軽いやけどをしました。皮膚が赤く、ひりひりします。",
                ru: "У меня лёгкий ожог руки: кожа красная, жжёт.",
                fr: "J’ai une légère brûlure à la main ou au bras\u00a0: la peau est rouge et ça brûle."
              } },
              moderate: { code: "MOD01-ARM-05-2", urgent: false, text: {
                vi: "Tay tôi bị bỏng, da phồng rộp, rất đau.",
                en: "I have a burn on my hand or arm with blisters, and it is very painful.",
                zh: "我的手或手臂烧烫伤，起了水泡，非常疼。",
                ko: "손이나 팔에 화상을 입어 물집이 생겼고 매우 아파요.",
                ja: "手や腕のやけどで水ぶくれができ、とても痛いです。",
                ru: "У меня ожог руки с волдырями, очень больно.",
                fr: "J’ai une brûlure au bras ou à la main avec des cloques, très douloureuse."
              } },
              severe: { code: "MOD01-ARM-05-3", urgent: true, text: {
                vi: "Tay tôi bị bỏng rộng, da phồng rộp, trắng bệch hoặc cháy sém. Tôi cần cấp cứu.",
                en: "I have a large burn on my hand or arm, with blisters, or white or charred skin. I need emergency help.",
                zh: "我的手或手臂大面积烧伤，起了水泡，或者皮肤发白、焦黑。我需要急救。",
                ko: "손이나 팔에 넓게 화상을 입었어요. 물집이 생겼거나 피부가 하얗거나 검게 탔어요. 응급 치료가 필요해요.",
                ja: "手や腕に広くやけどを負い、水ぶくれができているか、皮膚が白くなったり黒く焦げたりしています。緊急の治療が必要です。",
                ru: "У меня обширный ожог руки: волдыри, белая или обугленная кожа. Мне нужна срочная медицинская помощь.",
                fr: "J’ai une brûlure étendue au bras ou à la main, avec des cloques, ou la peau blanche ou carbonisée. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "arm-finger",
            icon: "hand",
            label: { vi: "Ngón tay bị kẹt, dập", en: "Trapped or crushed finger", zh: "手指夹伤、压伤", ko: "손가락 끼임·짓눌림", ja: "指をはさんだ・つぶした", ru: "Защемление, ушиб пальца", fr: "Doigt coincé ou écrasé" },
            phrases: {
              mild: { code: "MOD01-ARM-06-1", urgent: false, text: {
                vi: "Ngón tay tôi bị kẹt, hơi sưng và đau.",
                en: "I trapped my finger. It is a little swollen and sore.",
                zh: "我的手指被夹了，有点肿，有点疼。",
                ko: "손가락이 끼어서 조금 붓고 아파요.",
                ja: "指をはさんで、少し腫れて痛いです。",
                ru: "У меня прищемлён палец, он немного опух и болит.",
                fr: "Je me suis coincé le doigt, il est un peu enflé et douloureux."
              } },
              moderate: { code: "MOD01-ARM-06-2", urgent: false, text: {
                vi: "Ngón tay tôi bị dập, sưng tím, cử động khó.",
                en: "My finger is crushed, swollen and bruised, and hard to move.",
                zh: "我的手指被压伤了，肿胀发紫，很难活动。",
                ko: "손가락이 짓눌려서 붓고 멍들었으며 움직이기 힘들어요.",
                ja: "指をつぶして、腫れて紫色になり、動かしにくいです。",
                ru: "Палец раздавлен, опух и посинел, двигать им трудно.",
                fr: "Mon doigt est écrasé, enflé et bleu, j’ai du mal à le bouger."
              } },
              severe: { code: "MOD01-ARM-06-3", urgent: true, text: {
                vi: "Ngón tay tôi bị dập nát hoặc bị đứt rời. Tôi cần cấp cứu.",
                en: "My finger is badly crushed or has been cut off. I need emergency help.",
                zh: "我的手指被严重压碎，或者被切断了。我需要急救。",
                ko: "손가락이 심하게 으스러졌거나 잘렸어요. 응급 치료가 필요해요.",
                ja: "指がひどくつぶれたか、切断されました。緊急の治療が必要です。",
                ru: "Палец сильно раздроблен или отрезан. Мне нужна срочная медицинская помощь.",
                fr: "Mon doigt est broyé ou sectionné. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "arm-numb",
            icon: "zap",
            label: { vi: "Tê, yếu tay", en: "Numb or weak arm", zh: "手臂麻木、无力", ko: "팔 저림·힘 빠짐", ja: "腕のしびれ・脱力", ru: "Онемение, слабость руки", fr: "Bras engourdi ou faible" },
            phrases: {
              mild: { code: "MOD01-ARM-07-1", urgent: false, text: {
                vi: "Tay tôi hơi tê, như kiến bò.",
                en: "My arm feels a little numb and tingly.",
                zh: "我的手臂有点麻，像有蚂蚁在爬。",
                ko: "팔이 조금 저리고 찌릿찌릿해요.",
                ja: "腕が少ししびれて、ぴりぴりします。",
                ru: "У меня немного немеет рука, покалывает.",
                fr: "J’ai le bras un peu engourdi, avec des fourmillements."
              } },
              moderate: { code: "MOD01-ARM-07-2", urgent: false, text: {
                vi: "Tay tôi tê bì, châm chích nhiều trong nhiều giờ, nhưng vẫn cầm nắm bình thường.",
                en: "My arm has been very numb and tingly for hours, but I can still grip normally.",
                zh: "我的手臂麻木、刺痛了好几个小时，但还能正常抓握。",
                ko: "몇 시간째 팔이 많이 저리고 찌릿하지만, 물건은 평소처럼 쥘 수 있어요.",
                ja: "何時間も腕がひどくしびれてぴりぴりしますが、物は普通につかめます。",
                ru: "Рука уже несколько часов сильно немеет и покалывает, но сжимать предметы могу как обычно.",
                fr: "Mon bras est très engourdi, avec des fourmillements depuis des heures, mais je peux serrer les objets normalement."
              } },
              severe: { code: "MOD01-ARM-07-3", urgent: true, text: {
                vi: "Tôi đột ngột bị tê hoặc yếu một bên tay, không nhấc tay lên được, hoặc bị méo miệng, nói khó. Tôi cần cấp cứu.",
                en: "Suddenly one arm has gone numb or weak, or I cannot lift it, or my face droops, or I have trouble speaking. I need emergency help.",
                zh: "我突然一侧手臂发麻或无力、抬不起来，或者嘴歪、说话困难。我需要急救。",
                ko: "갑자기 한쪽 팔이 저리거나 힘이 빠지거나 들 수 없어요. 또는 입이 비뚤어지거나 말하기가 어려워요. 응급 치료가 필요해요.",
                ja: "突然、片方の腕がしびれたり、力が入らなくなったり、上がらなくなったりしました。または口がゆがむ、話しにくいなどの症状があります。緊急の治療が必要です。",
                ru: "Внезапно онемела или ослабла одна рука, её не поднять, или перекосило лицо, трудно говорить. Мне нужна срочная медицинская помощь.",
                fr: "Soudain, un bras est devenu engourdi ou faible, ou je ne peux plus le lever, ou mon visage est déformé, ou j’ai du mal à parler. J’ai besoin d’une aide médicale urgente."
              } }
            }
          }
        ]
      },

      /* ═════════════════════════════ 5. CHÂN / LEGS & FEET ═════════════════════════════ */
      {
        id: "legs",
        icon: "footprints",
        label: { vi: "Chân", en: "Legs & feet", zh: "腿和脚", ko: "다리·발", ja: "脚・足", ru: "Ноги", fr: "Jambes et pieds" },
        symptoms: [
          {
            id: "leg-injury",
            icon: "bone",
            label: { vi: "Chấn thương chân", en: "Leg or foot injury", zh: "腿或脚受伤", ko: "다리·발 부상", ja: "脚・足のけが", ru: "Травма ноги", fr: "Blessure à la jambe ou au pied" },
            children: [
              {
                id: "leg-fracture",
                label: { vi: "Nghi gãy xương", en: "Possible broken bone", zh: "可能骨折", ko: "골절 의심", ja: "骨折の疑い", ru: "Возможен перелом", fr: "Fracture possible" },
                phrases: {
                  mild: { code: "MOD01-LEG-01-1", urgent: false, text: {
                    vi: "Chân tôi đau và hơi sưng sau khi ngã, vẫn đứng được.",
                    en: "My leg hurts and is a little swollen after a fall, but I can still stand.",
                    zh: "我摔倒后腿疼，有点肿，但还能站。",
                    ko: "넘어진 뒤 다리가 아프고 조금 부었지만 설 수는 있어요.",
                    ja: "転んだあと脚が痛く、少し腫れていますが、立つことはできます。",
                    ru: "После падения нога болит и немного опухла, но я могу стоять.",
                    fr: "Après une chute, j’ai mal à la jambe et elle est un peu enflée, mais je tiens debout."
                  } },
                  moderate: { code: "MOD01-LEG-01-2", urgent: false, text: {
                    vi: "Chân tôi sưng to, rất đau, không đứng hoặc đi được.",
                    en: "My leg is very swollen and very painful, and I cannot stand or walk on it.",
                    zh: "我的腿肿得很厉害，非常疼，站不起来也走不了。",
                    ko: "다리가 많이 붓고 매우 아파서 서거나 걸을 수 없어요.",
                    ja: "脚がひどく腫れてとても痛く、立つことも歩くこともできません。",
                    ru: "Нога сильно опухла и очень болит, я не могу на неё встать и идти.",
                    fr: "Ma jambe est très enflée et très douloureuse, je ne peux ni m’appuyer dessus ni marcher."
                  } },
                  severe: { code: "MOD01-LEG-01-3", urgent: true, text: {
                    vi: "Chân tôi bị biến dạng hoặc lộ xương ra ngoài. Tôi cần cấp cứu.",
                    en: "My leg is deformed or the bone is showing. I need emergency help.",
                    zh: "我的腿变形了，或者骨头露出来了。我需要急救。",
                    ko: "다리가 변형됐거나 뼈가 드러나 보여요. 응급 치료가 필요해요.",
                    ja: "脚が変形しているか、骨が見えています。緊急の治療が必要です。",
                    ru: "Нога деформирована или видна кость. Мне нужна срочная медицинская помощь.",
                    fr: "Ma jambe est déformée ou l’os est visible. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              },
              {
                id: "leg-sprain",
                label: { vi: "Bong gân, trẹo cổ chân", en: "Sprained ankle", zh: "脚踝扭伤", ko: "발목 삠", ja: "足首のねんざ", ru: "Растяжение голеностопа", fr: "Entorse de la cheville" },
                phrases: {
                  mild: { code: "MOD01-LEG-02-1", urgent: false, text: {
                    vi: "Tôi bị trẹo cổ chân, hơi đau, vẫn đi được.",
                    en: "I twisted my ankle. It hurts a little but I can still walk.",
                    zh: "我扭到了脚踝，有点疼，还能走路。",
                    ko: "발목을 삐었어요. 조금 아프지만 걸을 수는 있어요.",
                    ja: "足首をひねりました。少し痛いですが、歩けます。",
                    ru: "Подвернулась нога в голеностопе, болит несильно, могу идти.",
                    fr: "Je me suis tordu la cheville, j’ai un peu mal mais je peux marcher."
                  } },
                  moderate: { code: "MOD01-LEG-02-2", urgent: false, text: {
                    vi: "Cổ chân tôi sưng, đau nhiều khi đi lại.",
                    en: "My ankle is swollen and hurts a lot when I walk.",
                    zh: "我的脚踝肿了，走路时很疼。",
                    ko: "발목이 붓고 걸으면 많이 아파요.",
                    ja: "足首が腫れて、歩くととても痛いです。",
                    ru: "Голеностоп опух, при ходьбе сильно болит.",
                    fr: "Ma cheville est enflée et me fait très mal quand je marche."
                  } },
                  severe: { code: "MOD01-LEG-02-3", urgent: false, text: {
                    vi: "Cổ chân tôi sưng to, bầm tím nhiều hoặc không đặt chân xuống đất được. Tôi cần được khám ngay.",
                    en: "My ankle is badly swollen and bruised, or I cannot put any weight on it. I need to see a doctor right away.",
                    zh: "我的脚踝肿得很厉害、发青发紫，或者脚完全不能着地。我需要马上看医生。",
                    ko: "발목이 많이 붓고 멍이 들었거나, 발을 전혀 디딜 수 없어요. 바로 진료를 받아야 해요.",
                    ja: "足首がひどく腫れて青あざになっているか、足を地面につけられません。すぐに診察が必要です。",
                    ru: "Голеностоп сильно опух и посинел, или я не могу наступить на ногу. Мне нужно срочно к врачу.",
                    fr: "Ma cheville est très enflée, avec un gros hématome, ou je ne peux pas poser le pied par terre. J’ai besoin de voir un médecin tout de suite."
                  } }
                }
              },
              {
                id: "leg-knee",
                label: { vi: "Chấn thương đầu gối", en: "Knee injury", zh: "膝盖受伤", ko: "무릎 부상", ja: "ひざのけが", ru: "Травма колена", fr: "Blessure au genou" },
                phrases: {
                  mild: { code: "MOD01-LEG-03-1", urgent: false, text: {
                    vi: "Đầu gối tôi bị va đập, hơi đau.",
                    en: "I hit my knee and it hurts a little.",
                    zh: "我的膝盖撞了一下，有点疼。",
                    ko: "무릎을 부딪쳐서 조금 아파요.",
                    ja: "ひざをぶつけて、少し痛いです。",
                    ru: "У меня ушиб колена, болит несильно.",
                    fr: "Je me suis cogné le genou, j’ai un peu mal."
                  } },
                  moderate: { code: "MOD01-LEG-03-2", urgent: false, text: {
                    vi: "Đầu gối tôi sưng, đau khi co duỗi chân.",
                    en: "My knee is swollen and hurts when I bend or straighten my leg.",
                    zh: "我的膝盖肿了，弯腿或伸腿时疼。",
                    ko: "무릎이 붓고 다리를 굽히거나 펼 때 아파요.",
                    ja: "ひざが腫れて、曲げ伸ばしすると痛みます。",
                    ru: "Колено опухло и болит, когда сгибаю или разгибаю ногу.",
                    fr: "Mon genou est enflé et me fait mal quand je plie ou tends la jambe."
                  } },
                  severe: { code: "MOD01-LEG-03-3", urgent: true, text: {
                    vi: "Đầu gối tôi bị lệch hoặc biến dạng rõ. Tôi cần cấp cứu.",
                    en: "My knee looks clearly out of place or deformed. I need emergency help.",
                    zh: "我的膝盖明显错位或变形了。我需要急救。",
                    ko: "무릎이 눈에 띄게 어긋나거나 변형됐어요. 응급 치료가 필요해요.",
                    ja: "ひざが明らかにずれているか、変形しています。緊急の治療が必要です。",
                    ru: "Колено явно смещено или деформировано. Мне нужна срочная медицинская помощь.",
                    fr: "Mon genou est visiblement déplacé ou déformé. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              }
            ]
          },
          {
            id: "leg-exhaust-burn",
            icon: "bike",
            label: { vi: "Bỏng pô xe máy", en: "Motorbike exhaust burn", zh: "摩托车排气管烫伤", ko: "오토바이 머플러 화상", ja: "バイクのマフラーのやけど", ru: "Ожог о выхлопную трубу", fr: "Brûlure de pot d’échappement" },
            phrases: {
              mild: { code: "MOD01-LEG-04-1", urgent: false, text: {
                vi: "Chân tôi bị bỏng pô xe máy, vết bỏng nhỏ, đỏ và rát.",
                en: "I burned my leg on a motorbike exhaust pipe. The burn is small, red and stinging.",
                zh: "我的腿被摩托车排气管烫伤了，伤处不大，发红，火辣辣地疼。",
                ko: "다리를 오토바이 머플러에 데었어요. 화상은 작고 빨갛고 따가워요.",
                ja: "脚をバイクのマフラーでやけどしました。やけどは小さく、赤くてひりひりします。",
                ru: "У меня ожог ноги о выхлопную трубу мотоцикла: небольшой, красный, жжёт.",
                fr: "Je me suis brûlé la jambe sur un pot d’échappement de moto. La brûlure est petite, rouge et elle me brûle."
              } },
              moderate: { code: "MOD01-LEG-04-2", urgent: false, text: {
                vi: "Chân tôi bị bỏng pô xe máy, da phồng rộp, rất đau.",
                en: "I burned my leg on a motorbike exhaust. It has blistered and is very painful.",
                zh: "我的腿被摩托车排气管烫伤，起了水泡，非常疼。",
                ko: "다리를 오토바이 머플러에 데어서 물집이 생겼고 매우 아파요.",
                ja: "脚をバイクのマフラーでやけどして水ぶくれができ、とても痛いです。",
                ru: "У меня ожог ноги о выхлопную трубу, появились волдыри, очень больно.",
                fr: "Je me suis brûlé la jambe sur un pot d’échappement, j’ai des cloques et très mal."
              } },
              severe: { code: "MOD01-LEG-04-3", urgent: false, text: {
                vi: "Vết bỏng pô ở chân tôi sâu (da trắng bệch hoặc cháy sém) hoặc rộng hơn lòng bàn tay. Tôi cần được xử lý ngay.",
                en: "The exhaust burn on my leg is deep (white or charred skin) or larger than my palm. I need treatment right away.",
                zh: "我腿上的排气管烫伤很深（皮肤发白或焦黑），或者面积比手掌还大。我需要马上处理。",
                ko: "다리의 머플러 화상이 깊거나(피부가 하얗거나 검게 탔어요) 손바닥보다 넓어요. 바로 치료를 받아야 해요.",
                ja: "脚のマフラーのやけどが深い（皮膚が白い、または黒く焦げている）か、手のひらより広いです。すぐに手当てが必要です。",
                ru: "Ожог на ноге от выхлопной трубы глубокий (кожа белая или обугленная) или больше ладони. Мне нужна медицинская помощь прямо сейчас.",
                fr: "La brûlure de pot d’échappement sur ma jambe est profonde (peau blanche ou carbonisée) ou plus grande que ma paume. J’ai besoin de soins tout de suite."
              } }
            }
          },
          {
            id: "leg-wound",
            icon: "bandage",
            label: { vi: "Vết cắt, chảy máu", en: "Cut or bleeding", zh: "割伤、出血", ko: "베인 상처·출혈", ja: "切り傷・出血", ru: "Порез, кровотечение", fr: "Coupure, saignement" },
            phrases: {
              mild: { code: "MOD01-LEG-05-1", urgent: false, text: {
                vi: "Chân tôi bị một vết đứt nhỏ, chảy ít máu.",
                en: "I have a small cut on my leg or foot, bleeding a little.",
                zh: "我的腿或脚有一个小伤口，出了一点血。",
                ko: "다리나 발을 조금 베여서 피가 조금 나요.",
                ja: "脚や足を少し切って、少し出血しています。",
                ru: "У меня небольшой порез на ноге, немного кровит.",
                fr: "J’ai une petite coupure à la jambe ou au pied, qui saigne un peu."
              } },
              moderate: { code: "MOD01-LEG-05-2", urgent: false, text: {
                vi: "Chân tôi có vết cắt sâu, đã ép chặt một lúc nhưng vẫn chảy máu.",
                en: "I have a deep cut on my leg or foot. It is still bleeding after pressing on it for a while.",
                zh: "我的腿或脚有一道很深的伤口，按压了一会儿仍在出血。",
                ko: "다리나 발에 깊이 베인 상처가 있는데, 한동안 눌러도 계속 피가 나요.",
                ja: "脚や足に深い切り傷があり、しばらく押さえても出血が続いています。",
                ru: "У меня глубокий порез на ноге, после прижатия кровь всё ещё идёт.",
                fr: "J’ai une coupure profonde à la jambe ou au pied, qui saigne encore malgré la compression."
              } },
              severe: { code: "MOD01-LEG-05-3", urgent: true, text: {
                vi: "Chân tôi chảy máu rất nhiều hoặc máu phun thành tia. Tôi cần cấp cứu.",
                en: "My leg or foot is bleeding heavily, or the blood is spurting. I need emergency help.",
                zh: "我的腿或脚大量出血，或者血往外喷。我需要急救。",
                ko: "다리나 발에서 피가 많이 나거나 피가 뿜어져 나와요. 응급 치료가 필요해요.",
                ja: "脚や足から大量に出血しているか、血が噴き出しています。緊急の治療が必要です。",
                ru: "У меня сильное кровотечение из ноги, или кровь бьёт струёй. Мне нужна срочная медицинская помощь.",
                fr: "Ma jambe ou mon pied saigne abondamment, ou le sang gicle. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "leg-cramp",
            icon: "zap",
            label: { vi: "Chuột rút, đau cơ", en: "Cramp or muscle pain", zh: "抽筋、肌肉痛", ko: "쥐·근육통", ja: "こむら返り・筋肉痛", ru: "Судорога, боль в мышцах", fr: "Crampe, douleur musculaire" },
            phrases: {
              mild: { code: "MOD01-LEG-06-1", urgent: false, text: {
                vi: "Tôi bị chuột rút ở chân.",
                en: "I have a cramp in my leg.",
                zh: "我的腿抽筋了。",
                ko: "다리에 쥐가 났어요.",
                ja: "脚がつりました。",
                ru: "У меня судорога в ноге.",
                fr: "J’ai une crampe à la jambe."
              } },
              moderate: { code: "MOD01-LEG-06-2", urgent: false, text: {
                vi: "Chân tôi chuột rút nhiều lần, đau cơ, đi lại khó khăn.",
                en: "I keep getting leg cramps and muscle pain, and it is hard to walk.",
                zh: "我的腿反复抽筋，肌肉疼，走路很困难。",
                ko: "다리에 계속 쥐가 나고 근육이 아파서 걷기 힘들어요.",
                ja: "何度も脚がつり、筋肉が痛くて歩くのがつらいです。",
                ru: "У меня повторяются судороги в ногах, болят мышцы, трудно ходить.",
                fr: "J’ai des crampes répétées et des douleurs musculaires aux jambes, j’ai du mal à marcher."
              } },
              severe: { code: "MOD01-LEG-06-3", urgent: false, text: {
                vi: "Tôi bị chuột rút dữ dội, không duỗi thẳng chân được, hoặc cơ sưng đau nhiều kèm nước tiểu sẫm màu. Tôi cần được khám ngay.",
                en: "I have a severe cramp and cannot straighten my leg, or my muscles are swollen and very painful and my urine is dark. I need to see a doctor right away.",
                zh: "我抽筋很严重，腿伸不直，或者肌肉肿痛得厉害、尿色发深。我需要马上看医生。",
                ko: "쥐가 심하게 나서 다리를 펼 수 없거나, 근육이 붓고 매우 아프며 소변 색이 진해요. 바로 진료를 받아야 해요.",
                ja: "脚がひどくつって伸ばせないか、筋肉が腫れてとても痛く、尿の色が濃いです。すぐに診察が必要です。",
                ru: "У меня сильная судорога, не могу выпрямить ногу, или мышцы опухли и очень болят, а моча тёмная. Мне нужно срочно к врачу.",
                fr: "J’ai une crampe violente et je ne peux pas tendre la jambe, ou mes muscles sont gonflés et très douloureux, avec des urines foncées. J’ai besoin de voir un médecin tout de suite."
              } }
            }
          },
          {
            id: "leg-blister",
            icon: "footprints",
            label: { vi: "Phồng rộp bàn chân", en: "Foot blisters", zh: "脚上起水泡", ko: "발 물집", ja: "足のまめ・水ぶくれ", ru: "Волдыри на стопах", fr: "Ampoules aux pieds" },
            phrases: {
              mild: { code: "MOD01-LEG-07-1", urgent: false, text: {
                vi: "Bàn chân tôi bị phồng rộp do đi bộ nhiều.",
                en: "I have blisters on my feet from walking a lot.",
                zh: "我走了很多路，脚上起了水泡。",
                ko: "많이 걸어서 발에 물집이 생겼어요.",
                ja: "たくさん歩いて、足にまめができました。",
                ru: "У меня на стопах волдыри от долгой ходьбы.",
                fr: "J’ai des ampoules aux pieds à force de marcher."
              } },
              moderate: { code: "MOD01-LEG-07-2", urgent: false, text: {
                vi: "Vết phồng ở bàn chân bị vỡ, rất đau khi đi.",
                en: "The blisters on my feet have burst and it is very painful to walk.",
                zh: "我脚上的水泡破了，走路很疼。",
                ko: "발의 물집이 터져서 걸을 때 매우 아파요.",
                ja: "足のまめがつぶれて、歩くととても痛いです。",
                ru: "Волдыри на стопах лопнули, идти очень больно.",
                fr: "Mes ampoules aux pieds ont éclaté, j’ai très mal en marchant."
              } },
              severe: { code: "MOD01-LEG-07-3", urgent: false, text: {
                vi: "Vết phồng ở bàn chân sưng đỏ, có mủ, hoặc tôi bị sốt. Tôi cần được khám ngay.",
                en: "The blisters on my feet are red and swollen with pus, or I have a fever. I need to see a doctor right away.",
                zh: "我脚上的水泡红肿化脓，或者我发烧了。我需要马上看医生。",
                ko: "발의 물집이 빨갛게 붓고 고름이 있거나, 열이 나요. 바로 진료를 받아야 해요.",
                ja: "足のまめが赤く腫れて膿が出ているか、熱があります。すぐに診察が必要です。",
                ru: "Волдыри на стопах покраснели, опухли, есть гной, или у меня температура. Мне нужно срочно к врачу.",
                fr: "Mes ampoules aux pieds sont rouges, gonflées, avec du pus, ou j’ai de la fièvre. J’ai besoin de voir un médecin tout de suite."
              } }
            }
          }
        ]
      },

      /* ═════════════════════════ 6. DA & TOÀN THÂN / SKIN & WHOLE BODY ═════════════════════════ */
      {
        id: "skin",
        icon: "person-standing",
        label: { vi: "Da & toàn thân", en: "Skin & whole body", zh: "皮肤与全身", ko: "피부·전신", ja: "皮膚・全身", ru: "Кожа и общее состояние", fr: "Peau et état général" },
        symptoms: [
          {
            id: "skin-abrasion",
            icon: "bandage",
            label: { vi: "Trầy xước da (ngã xe)", en: "Scrapes, road rash", zh: "擦伤（摔车）", ko: "찰과상(넘어짐)", ja: "すり傷（転倒）", ru: "Ссадины (падение)", fr: "Écorchures (chute)" },
            phrases: {
              mild: { code: "MOD01-SKIN-01-1", urgent: false, text: {
                vi: "Tôi bị trầy xước da nhẹ do ngã xe.",
                en: "I have minor scrapes from a motorbike fall.",
                zh: "我摔车了，皮肤有轻微擦伤。",
                ko: "오토바이에서 넘어져 가벼운 찰과상을 입었어요.",
                ja: "バイクで転んで、軽いすり傷があります。",
                ru: "У меня небольшие ссадины после падения с мотоцикла.",
                fr: "J’ai de légères écorchures après une chute de moto."
              } },
              moderate: { code: "MOD01-SKIN-01-2", urgent: false, text: {
                vi: "Tôi bị trầy xước rộng, còn dính đất cát, rất rát.",
                en: "I have large scrapes with dirt and grit still in them, and they sting a lot.",
                zh: "我大面积擦伤，伤口里还有泥沙，非常疼。",
                ko: "넓게 까졌고 상처에 흙과 모래가 묻어 있어 매우 따가워요.",
                ja: "広い範囲をすりむいて、土や砂が入ったままで、とてもひりひりします。",
                ru: "У меня большие ссадины, в них грязь и песок, сильно жжёт.",
                fr: "J’ai de grandes écorchures avec de la terre et du gravier dedans, ça brûle beaucoup."
              } },
              severe: { code: "MOD01-SKIN-01-3", urgent: false, text: {
                vi: "Tôi bị trầy xước sâu trên diện rộng, mất nhiều da, vết thương rỉ máu. Tôi cần được xử lý ngay.",
                en: "I have deep scrapes over a large area, with a lot of skin missing and oozing blood. I need treatment right away.",
                zh: "我大面积深度擦伤，掉了很多皮，伤口在渗血。我需要马上处理。",
                ko: "넓은 부위가 깊게 까져서 피부가 많이 벗겨지고 피가 배어 나와요. 바로 치료를 받아야 해요.",
                ja: "広い範囲を深くすりむいて、皮膚が大きくはがれ、血がにじんでいます。すぐに手当てが必要です。",
                ru: "У меня глубокие обширные ссадины, содрано много кожи, раны сочатся кровью. Мне нужна медицинская помощь прямо сейчас.",
                fr: "J’ai des écorchures profondes et étendues, avec beaucoup de peau arrachée, qui suintent. J’ai besoin de soins tout de suite."
              } }
            }
          },
          {
            id: "skin-infection",
            icon: "alert-circle",
            label: { vi: "Vết thương sưng, có mủ", en: "Wound getting infected", zh: "伤口红肿、化脓", ko: "상처가 붓고 고름", ja: "傷の腫れ・化膿", ru: "Рана воспалилась", fr: "Plaie qui s’infecte" },
            phrases: {
              mild: { code: "MOD01-SKIN-02-1", urgent: false, text: {
                vi: "Vết thương của tôi hơi đỏ và đau hơn trước.",
                en: "My wound is slightly red and more painful than before.",
                zh: "我的伤口有点发红，比之前更疼。",
                ko: "상처가 조금 빨개지고 전보다 더 아파요.",
                ja: "傷が少し赤くなり、前より痛みが増しています。",
                ru: "Рана немного покраснела и болит сильнее, чем раньше.",
                fr: "Ma plaie est un peu rouge et plus douloureuse qu’avant."
              } },
              moderate: { code: "MOD01-SKIN-02-2", urgent: false, text: {
                vi: "Vết thương (hoặc vết bỏng) của tôi sưng đỏ, nóng và có mủ.",
                en: "My wound (or burn) is red, swollen and warm, and there is pus.",
                zh: "我的伤口（或烫伤处）红肿、发热，还有脓。",
                ko: "상처(또는 화상 부위)가 빨갛게 붓고 뜨거우며 고름이 있어요.",
                ja: "傷（またはやけど）が赤く腫れて熱を持ち、膿が出ています。",
                ru: "Рана (или ожог) покраснела, опухла, горячая, есть гной.",
                fr: "Ma plaie (ou ma brûlure) est rouge, gonflée et chaude, et il y a du pus."
              } },
              severe: { code: "MOD01-SKIN-02-3", urgent: true, text: {
                vi: "Vùng đỏ quanh vết thương lan rộng nhanh, kèm sốt cao, rét run hoặc người lả đi. Tôi cần cấp cứu.",
                en: "The redness around my wound is spreading fast, with a high fever, chills or feeling very weak. I need emergency help.",
                zh: "我伤口周围的红肿迅速扩散，同时发高烧、打寒战或全身无力。我需要急救。",
                ko: "상처 주변의 붉은 부위가 빠르게 번지고, 고열이나 오한이 있거나 기운이 없어요. 응급 치료가 필요해요.",
                ja: "傷のまわりの赤みが急に広がり、高熱、寒気、またはひどいだるさがあります。緊急の治療が必要です。",
                ru: "Покраснение вокруг раны быстро распространяется, и у меня высокая температура, озноб или сильная слабость. Мне нужна срочная медицинская помощь.",
                fr: "La rougeur autour de ma plaie s’étend vite, avec une forte fièvre, des frissons ou une grande faiblesse. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "allergy",
            icon: "sparkles",
            label: { vi: "Dị ứng, nổi mẩn", en: "Allergic reaction, rash", zh: "过敏、皮疹", ko: "알레르기·발진", ja: "アレルギー・発疹", ru: "Аллергия, сыпь", fr: "Allergie, éruption" },
            /* Hives + swelling of lips/eyes = anaphylaxis grade I (TT 51/2017; MOD.05 "call 115 on suspicion") ⇒ urgent. */
            hints: { moderate: HINT_MODERATE_NOW },
            phrases: {
              mild: { code: "MOD01-SKIN-03-1", urgent: false, text: {
                vi: "Tôi bị nổi mẩn ngứa trên da.",
                en: "I have an itchy rash on my skin.",
                zh: "我皮肤上起了疹子，很痒。",
                ko: "피부에 가려운 발진이 생겼어요.",
                ja: "皮膚にかゆい発疹が出ています。",
                ru: "У меня зудящая сыпь на коже.",
                fr: "J’ai des plaques qui démangent sur la peau."
              } },
              moderate: { code: "MOD01-SKIN-03-2", urgent: true, text: {
                vi: "Tôi nổi mề đay khắp người, môi hoặc mắt đang sưng lên. Tôi cần cấp cứu.",
                en: "I have hives all over my body, and my lips or eyes are swelling. I need emergency help.",
                zh: "我全身起荨麻疹，嘴唇或眼睛正在肿起来。我需要急救。",
                ko: "온몸에 두드러기가 났고 입술이나 눈이 붓고 있어요. 응급 치료가 필요해요.",
                ja: "全身にじんましんが出て、唇や目が腫れてきています。緊急の治療が必要です。",
                ru: "У меня крапивница по всему телу, и отекают губы или глаза. Мне нужна срочная медицинская помощь.",
                fr: "J’ai de l’urticaire sur tout le corps, et mes lèvres ou mes yeux gonflent. J’ai besoin d’une aide médicale urgente."
              } },
              severe: { code: "MOD01-SKIN-03-3", urgent: true, text: {
                vi: "Tôi bị dị ứng nặng: họng hoặc lưỡi đang sưng, khó thở, hoặc choáng váng như sắp ngất. Tôi cần cấp cứu.",
                en: "I am having a severe allergic reaction: my throat or tongue is swelling, I have trouble breathing, or I feel faint. I need emergency help.",
                zh: "我严重过敏：喉咙或舌头正在肿胀、呼吸困难，或者头晕得快要晕倒。我需要急救。",
                ko: "심한 알레르기 반응이에요. 목이나 혀가 붓거나, 숨쉬기 힘들거나, 쓰러질 것처럼 어지러워요. 응급 치료가 필요해요.",
                ja: "ひどいアレルギー反応です。のどや舌が腫れている、息が苦しい、または気が遠くなりそうです。緊急の治療が必要です。",
                ru: "У меня тяжёлая аллергическая реакция: отекает горло или язык, трудно дышать или мне дурно. Мне нужна срочная медицинская помощь.",
                fr: "Je fais une réaction allergique grave\u00a0: ma gorge ou ma langue gonfle, j’ai du mal à respirer, ou j’ai l’impression que je vais m’évanouir. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "bites",
            icon: "bug",
            label: { vi: "Bị cắn, đốt", en: "Bites and stings", zh: "咬伤、蜇伤", ko: "물림·쏘임", ja: "かまれた・刺された", ru: "Укусы и ужаления", fr: "Morsures et piqûres" },
            children: [
              {
                id: "bite-insect",
                label: { vi: "Ong, côn trùng đốt", en: "Bee or insect sting", zh: "蜂或昆虫蜇伤", ko: "벌·벌레 쏘임", ja: "ハチ・虫に刺された", ru: "Ужаление пчелы или насекомого", fr: "Piqûre d’abeille ou d’insecte" },
                /* MOD.05 sting: many stings (hornets/wasps) ⇒ call 115 even without symptoms yet, so moderate is urgent. */
                hints: { moderate: HINT_MODERATE_NOW },
                phrases: {
                  mild: { code: "MOD01-SKIN-04-1", urgent: false, text: {
                    vi: "Tôi bị côn trùng đốt, chỗ đốt hơi sưng và ngứa.",
                    en: "I was stung by an insect. The spot is a little swollen and itchy.",
                    zh: "我被虫子蜇了，被蜇的地方有点肿、发痒。",
                    ko: "벌레에 쏘였는데 쏘인 곳이 조금 붓고 가려워요.",
                    ja: "虫に刺されて、刺されたところが少し腫れてかゆいです。",
                    ru: "Меня ужалило насекомое, место ужаления немного опухло и чешется.",
                    fr: "J’ai une piqûre d’insecte, un peu enflée, qui démange."
                  } },
                  moderate: { code: "MOD01-SKIN-04-2", urgent: true, text: {
                    vi: "Tôi bị ong đốt nhiều nốt (ong vò vẽ, ong bắp cày hoặc ong mật), chỗ đốt sưng to và rất đau. Tôi cần cấp cứu.",
                    en: "I have been stung many times by bees, wasps or hornets. The stings are very swollen and painful. I need emergency help.",
                    zh: "我被蜂蜇了很多下（胡蜂、马蜂或蜜蜂），被蜇处肿得很大，非常疼。我需要急救。",
                    ko: "벌(말벌이나 꿀벌)에 여러 번 쏘였는데 쏘인 곳이 크게 붓고 매우 아파요. 응급 치료가 필요해요.",
                    ja: "ハチ（スズメバチ、アシナガバチ、ミツバチなど）に何か所も刺されて、大きく腫れてとても痛いです。緊急の治療が必要です。",
                    ru: "Меня много раз ужалили пчёлы, осы или шершни, места ужалений сильно опухли и болят. Мне нужна срочная медицинская помощь.",
                    fr: "J’ai de nombreuses piqûres d’abeilles, de guêpes ou de frelons, très enflées et douloureuses. J’ai besoin d’une aide médicale urgente."
                  } },
                  severe: { code: "MOD01-SKIN-04-3", urgent: true, text: {
                    vi: "Tôi bị ong đốt, mặt hoặc họng đang sưng lên, hoặc khó thở, choáng váng. Tôi cần cấp cứu.",
                    en: "I was stung by a bee or wasp and my face or throat is swelling, or I have trouble breathing or feel faint. I need emergency help.",
                    zh: "我被蜂蜇了，脸或喉咙正在肿起来，或者呼吸困难、头晕。我需要急救。",
                    ko: "벌에 쏘였는데 얼굴이나 목이 붓고 있거나, 숨쉬기 힘들거나 어지러워요. 응급 치료가 필요해요.",
                    ja: "ハチに刺されて、顔やのどが腫れてきているか、息が苦しい、またはふらふらします。緊急の治療が必要です。",
                    ru: "Меня ужалила пчела или оса: отекает лицо или горло, или трудно дышать, кружится голова. Мне нужна срочная медицинская помощь.",
                    fr: "Après une piqûre d’abeille ou de guêpe, mon visage ou ma gorge gonfle, ou j’ai du mal à respirer ou des vertiges. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              },
              {
                id: "bite-snake",
                label: { vi: "Rắn cắn", en: "Snake bite", zh: "蛇咬伤", ko: "뱀에 물림", ja: "ヘビにかまれた", ru: "Укус змеи", fr: "Morsure de serpent" },
                /* Every level is urgent (krait bites can be painless and paralyse hours later), so the levels are named
                   by what the patient has, never "Nhẹ / Mild", and no hint may invite walking (MOD.05 snakebite). */
                labels: {
                  mild: LABEL_NO_SYMPTOMS,
                  moderate: { vi: "Sưng đau chỗ cắn", en: "Swelling and pain at the bite", zh: "咬伤处肿痛", ko: "물린 곳이 붓고 아픔", ja: "かまれた所の腫れと痛み", ru: "Отёк и боль в месте укуса", fr: "Enflure et douleur à la morsure" },
                  severe: { vi: "Triệu chứng toàn thân", en: "Symptoms elsewhere in the body", zh: "全身症状", ko: "전신 증상", ja: "全身の症状", ru: "Общие симптомы", fr: "Symptômes dans tout le corps" }
                },
                hints: {
                  mild: { vi: "Vẫn phải vào viện ngay, không tự đi bộ", en: "Still go to hospital now — do not walk", zh: "仍须马上去医院，不要自己走路", ko: "그래도 바로 병원에 가야 하며 걷지 마세요", ja: "すぐ病院へ。自分で歩かないで", ru: "Всё равно срочно в больницу, не ходить", fr: "Aller à l’hôpital tout de suite, sans marcher" },
                  moderate: { vi: "Chỗ cắn sưng, đau tăng dần", en: "The bite is swelling and getting more painful", zh: "咬伤处肿胀，越来越疼", ko: "물린 곳이 붓고 점점 더 아파요", ja: "かまれた所が腫れ、痛みが強くなる", ru: "Место укуса опухает, боль нарастает", fr: "La morsure gonfle et fait de plus en plus mal" },
                  severe: { vi: "Khó thở, sụp mí hoặc chảy máu không cầm", en: "Trouble breathing, drooping eyelids or bleeding that does not stop", zh: "呼吸困难、眼皮下垂或出血不止", ko: "호흡곤란, 눈꺼풀 처짐 또는 멈추지 않는 출혈", ja: "息苦しさ、まぶたの垂れ下がり、止まらない出血", ru: "Трудно дышать, опускаются веки или не останавливается кровь", fr: "Difficultés à respirer, paupières qui tombent ou saignement qui ne s’arrête pas" }
                },
                phrases: {
                  mild: { code: "MOD01-SKIN-05-1", urgent: true, text: {
                    vi: "Tôi vừa bị rắn cắn, chưa thấy triệu chứng gì. Tôi cần đến bệnh viện ngay.",
                    en: "I have just been bitten by a snake. I have no symptoms yet, but I need to get to a hospital now.",
                    zh: "我刚被蛇咬了，还没有什么症状。我需要马上去医院。",
                    ko: "방금 뱀에 물렸어요. 아직 증상은 없지만 지금 바로 병원에 가야 해요.",
                    ja: "たった今ヘビにかまれました。まだ症状はありませんが、すぐに病院へ行く必要があります。",
                    ru: "Меня только что укусила змея. Симптомов пока нет, но мне нужно срочно в больницу.",
                    fr: "Un serpent vient de me mordre. Je n’ai pas encore de symptômes, mais je dois aller à l’hôpital tout de suite."
                  } },
                  moderate: { code: "MOD01-SKIN-05-2", urgent: true, text: {
                    vi: "Tôi bị rắn cắn, chỗ cắn sưng và đau tăng dần. Tôi cần cấp cứu.",
                    en: "I was bitten by a snake. The bite is swelling and the pain is getting worse. I need emergency help.",
                    zh: "我被蛇咬了，伤口肿胀，疼痛越来越厉害。我需要急救。",
                    ko: "뱀에 물렸는데 물린 곳이 붓고 통증이 점점 심해져요. 응급 치료가 필요해요.",
                    ja: "ヘビにかまれて、かまれたところが腫れ、痛みがだんだん強くなっています。緊急の治療が必要です。",
                    ru: "Меня укусила змея, место укуса опухает, боль усиливается. Мне нужна срочная медицинская помощь.",
                    fr: "J’ai une morsure de serpent, elle gonfle et la douleur augmente. J’ai besoin d’une aide médicale urgente."
                  } },
                  severe: { code: "MOD01-SKIN-05-3", urgent: true, text: {
                    vi: "Tôi bị rắn cắn, đang khó thở, sụp mí mắt hoặc chảy máu không cầm được. Tôi cần cấp cứu.",
                    en: "I was bitten by a snake. I have trouble breathing, drooping eyelids or bleeding that will not stop. I need emergency help.",
                    zh: "我被蛇咬了，现在呼吸困难、眼皮下垂，或者出血止不住。我需要急救。",
                    ko: "뱀에 물렸는데 숨쉬기 힘들고 눈꺼풀이 처지거나 피가 멈추지 않아요. 응급 치료가 필요해요.",
                    ja: "ヘビにかまれて、息が苦しい、まぶたが下がる、または出血が止まらない状態です。緊急の治療が必要です。",
                    ru: "Меня укусила змея: трудно дышать, опускаются веки или не останавливается кровотечение. Мне нужна срочная медицинская помощь.",
                    fr: "J’ai une morsure de serpent\u00a0: j’ai du mal à respirer, les paupières qui tombent ou un saignement qui ne s’arrête pas. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              },
              {
                id: "bite-animal",
                label: { vi: "Chó, mèo, khỉ cắn", en: "Dog, cat or monkey bite", zh: "狗、猫、猴子咬伤", ko: "개·고양이·원숭이에 물림", ja: "犬・猫・サルにかまれた", ru: "Укус собаки, кошки, обезьяны", fr: "Morsure de chien, chat ou singe" },
                /* MOD.05 dogbite: every scratch or bite needs rabies advice the same day — the generic hints undersell it. */
                hints: {
                  mild: { vi: "Cào xước nhẹ — vẫn cần hỏi về tiêm phòng dại", en: "A light scratch — still ask about the rabies vaccine", zh: "轻微抓伤——仍需咨询狂犬疫苗", ko: "살짝 긁힘 — 그래도 광견병 예방접종 상담이 필요해요", ja: "軽いひっかき傷 — それでも狂犬病ワクチンの相談が必要", ru: "Лёгкая царапина — всё равно нужна консультация о прививке от бешенства", fr: "Légère griffure — demander quand même un avis sur le vaccin contre la rage" },
                  moderate: { vi: "Vết cắn chảy máu — cần tiêm phòng dại trong ngày", en: "A bite that bleeds — rabies vaccine needed today", zh: "咬伤出血——需要当天打狂犬疫苗", ko: "피가 나는 물림 — 오늘 광견병 예방접종이 필요해요", ja: "出血するかみ傷 — 今日中に狂犬病ワクチンが必要", ru: "Укус с кровью — прививка от бешенства нужна сегодня", fr: "Morsure qui saigne — vaccin contre la rage à faire aujourd’hui" }
                },
                phrases: {
                  mild: { code: "MOD01-SKIN-06-1", urgent: false, text: {
                    vi: "Tôi bị chó, mèo hoặc khỉ cào xước nhẹ. Tôi cần được tư vấn tiêm phòng dại.",
                    en: "I was lightly scratched by a dog, cat or monkey. I need advice about a rabies vaccine.",
                    zh: "我被狗、猫或猴子轻微抓伤了。我需要咨询是否要打狂犬疫苗。",
                    ko: "개나 고양이, 원숭이에게 살짝 긁혔어요. 광견병 예방접종에 대해 상담이 필요해요.",
                    ja: "犬か猫かサルに軽くひっかかれました。狂犬病ワクチンについて相談が必要です。",
                    ru: "Меня слегка поцарапала собака, кошка или обезьяна. Мне нужна консультация о прививке от бешенства.",
                    fr: "J’ai une légère griffure de chien, de chat ou de singe. J’ai besoin d’un avis sur le vaccin contre la rage."
                  } },
                  moderate: { code: "MOD01-SKIN-06-2", urgent: false, text: {
                    vi: "Tôi bị chó, mèo hoặc khỉ cắn chảy máu. Tôi cần được tiêm phòng dại.",
                    en: "I was bitten by a dog, cat or monkey and it is bleeding. I need a rabies vaccine.",
                    zh: "我被狗、猫或猴子咬伤出血了。我需要打狂犬疫苗。",
                    ko: "개나 고양이, 원숭이에게 물려서 피가 나요. 광견병 예방접종이 필요해요.",
                    ja: "犬か猫かサルにかまれて出血しています。狂犬病ワクチンが必要です。",
                    ru: "Меня укусила собака, кошка или обезьяна, идёт кровь. Мне нужна прививка от бешенства.",
                    fr: "J’ai une morsure de chien, de chat ou de singe qui saigne. J’ai besoin du vaccin contre la rage."
                  } },
                  severe: { code: "MOD01-SKIN-06-3", urgent: true, text: {
                    vi: "Tôi bị cắn nhiều vết sâu, bị cắn vào mặt hoặc cổ, hoặc chảy máu nhiều không cầm. Tôi cần cấp cứu.",
                    en: "I have several deep bites or a bite on my face or neck, or the bleeding is heavy and will not stop. I need emergency help.",
                    zh: "我被咬了好几处很深的伤口，或者被咬到了脸或脖子，或者出血很多、止不住。我需要急救。",
                    ko: "여러 군데 깊이 물렸거나, 얼굴이나 목을 물렸거나, 피가 많이 나고 멈추지 않아요. 응급 치료가 필요해요.",
                    ja: "深くかまれた傷がいくつもあるか、顔や首をかまれたか、出血が多くて止まりません。緊急の治療が必要です。",
                    ru: "У меня несколько глубоких укусов или укус в лицо или шею, или сильное кровотечение не останавливается. Мне нужна срочная медицинская помощь.",
                    fr: "J’ai plusieurs morsures profondes ou une morsure au visage ou au cou, ou un saignement abondant qui ne s’arrête pas. J’ai besoin d’une aide médicale urgente."
                  } }
                }
              },
              {
                id: "bite-leech",
                label: { vi: "Vắt, đỉa cắn", en: "Leech bite", zh: "蚂蟥叮咬", ko: "거머리에 물림", ja: "ヒルにかまれた", ru: "Укус пиявки", fr: "Morsure de sangsue" },
                phrases: {
                  mild: { code: "MOD01-SKIN-07-1", urgent: false, text: {
                    vi: "Tôi bị vắt cắn, vết cắn vẫn rỉ máu.",
                    en: "A leech bit me and the bite is still oozing blood.",
                    zh: "我被蚂蟥叮了，伤口还在渗血。",
                    ko: "거머리에 물렸는데 물린 곳에서 아직 피가 조금씩 나요.",
                    ja: "ヒルにかまれて、傷口からまだ血がにじんでいます。",
                    ru: "Меня укусила пиявка, ранка всё ещё кровоточит.",
                    fr: "J’ai une morsure de sangsue qui saigne encore un peu."
                  } },
                  moderate: { code: "MOD01-SKIN-07-2", urgent: false, text: {
                    vi: "Tôi bị vắt cắn nhiều chỗ, chảy máu lâu không cầm.",
                    en: "I have leech bites in several places that keep bleeding for a long time.",
                    zh: "我被蚂蟥叮了好几处，流血很久都止不住。",
                    ko: "여러 군데 거머리에 물렸는데 피가 오랫동안 멈추지 않아요.",
                    ja: "何か所もヒルにかまれ、長い間血が止まりません。",
                    ru: "У меня несколько укусов пиявок, кровь долго не останавливается.",
                    fr: "J’ai plusieurs morsures de sangsues qui saignent longtemps sans s’arrêter."
                  } },
                  severe: { code: "MOD01-SKIN-07-3", urgent: false, text: {
                    vi: "Có con vắt chui vào mũi, tai hoặc mắt của tôi, không lấy ra được. Tôi cần được xử lý ngay.",
                    en: "A leech has got into my nose, ear or eye and I cannot get it out. I need treatment right away.",
                    zh: "有一条蚂蟥钻进了我的鼻子、耳朵或眼睛里，取不出来。我需要马上处理。",
                    ko: "거머리가 코나 귀, 눈에 들어갔는데 빼낼 수가 없어요. 바로 치료를 받아야 해요.",
                    ja: "ヒルが鼻か耳か目に入り込んで、取れません。すぐに手当てが必要です。",
                    ru: "Пиявка заползла мне в нос, ухо или глаз, я не могу её достать. Мне нужна медицинская помощь прямо сейчас.",
                    fr: "Une sangsue est entrée dans mon nez, mon oreille ou mon œil et je n’arrive pas à la retirer. J’ai besoin de soins tout de suite."
                  } }
                }
              }
            ]
          },
          {
            id: "fever",
            icon: "thermometer",
            label: { vi: "Sốt", en: "Fever", zh: "发烧", ko: "발열", ja: "発熱", ru: "Температура", fr: "Fièvre" },
            phrases: {
              mild: { code: "MOD01-SKIN-08-1", urgent: false, text: {
                vi: "Tôi bị sốt nhẹ.",
                en: "I have a slight fever.",
                zh: "我有点发烧。",
                ko: "미열이 있어요.",
                ja: "微熱があります。",
                ru: "У меня небольшая температура.",
                fr: "J’ai un peu de fièvre."
              } },
              moderate: { code: "MOD01-SKIN-08-2", urgent: false, text: {
                vi: "Tôi sốt trên 38,5 độ, đau đầu và đau mỏi người.",
                en: "I have a fever above 38.5 °C, with a headache and body aches.",
                zh: "我发烧超过38.5°C，头痛，全身酸痛。",
                ko: "38.5도가 넘는 열이 있고 머리가 아프며 온몸이 쑤셔요.",
                ja: "38.5度以上の熱があり、頭痛と体の痛みがあります。",
                ru: "У меня температура выше 38,5 °C, болит голова и ломит всё тело.",
                fr: "J’ai plus de 38,5 °C de fièvre, avec des maux de tête et des courbatures."
              } },
              severe: { code: "MOD01-SKIN-08-3", urgent: true, text: {
                vi: "Tôi sốt cao kèm lơ mơ, nổi chấm đỏ trên da, chảy máu chân răng, đau bụng nhiều hoặc nôn liên tục. Tôi cần cấp cứu.",
                en: "I have a high fever, and I feel confused or have red spots on my skin, bleeding gums, bad belly pain or constant vomiting. I need emergency help.",
                zh: "我发高烧，同时意识模糊、皮肤出现红点、牙龈出血、肚子很疼或不停呕吐。我需要急救。",
                ko: "고열이 있고, 정신이 몽롱하거나, 피부에 붉은 반점이 생겼거나, 잇몸에서 피가 나거나, 배가 많이 아프거나, 계속 토해요. 응급 치료가 필요해요.",
                ja: "高熱があり、意識がぼんやりしている、皮膚に赤い斑点が出ている、歯ぐきから出血する、お腹がひどく痛む、または吐き続けています。緊急の治療が必要です。",
                ru: "У меня высокая температура и спутанность сознания, красные точки на коже, кровоточат дёсны, сильно болит живот или не прекращается рвота. Мне нужна срочная медицинская помощь.",
                fr: "J’ai une forte fièvre avec les idées embrouillées, des petites taches rouges sur la peau, les gencives qui saignent, très mal au ventre ou des vomissements sans arrêt. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "heat",
            icon: "sun",
            label: { vi: "Say nắng, mất nước", en: "Heat illness, dehydration", zh: "中暑、脱水", ko: "더위 먹음·탈수", ja: "熱中症・脱水", ru: "Перегрев, обезвоживание", fr: "Coup de chaleur, déshydratation" },
            phrases: {
              mild: { code: "MOD01-SKIN-09-1", urgent: false, text: {
                vi: "Tôi thấy mệt, khát nước và nhức đầu vì nắng nóng.",
                en: "I feel tired and thirsty and have a headache from the heat.",
                zh: "天太热，我觉得累、口渴、头痛。",
                ko: "더위 때문에 피곤하고 목마르고 머리가 아파요.",
                ja: "暑さのせいで、だるくて喉が渇き、頭が痛いです。",
                ru: "Из-за жары у меня слабость, жажда и головная боль.",
                fr: "La chaleur me fatigue, j’ai soif et mal à la tête."
              } },
              moderate: { code: "MOD01-SKIN-09-2", urgent: false, text: {
                vi: "Tôi rất khát, đi tiểu ít, chóng mặt, buồn nôn và ra nhiều mồ hôi.",
                en: "I am very thirsty, passing little urine, dizzy, nauseous and sweating a lot.",
                zh: "我非常口渴，尿很少，头晕，恶心，出很多汗。",
                ko: "몹시 목마르고 소변이 적게 나오며 어지럽고 메스껍고 땀이 많이 나요.",
                ja: "とても喉が渇き、尿が少なく、めまいと吐き気があり、汗がたくさん出ます。",
                ru: "У меня сильная жажда, мало мочи, головокружение, тошнота и сильная потливость.",
                fr: "J’ai très soif, j’urine peu, j’ai des vertiges, des nausées et je transpire beaucoup."
              } },
              severe: { code: "MOD01-SKIN-09-3", urgent: true, text: {
                vi: "Sau khi ở ngoài nắng nóng, người tôi rất nóng, lơ mơ hoặc sắp ngất. Tôi cần cấp cứu.",
                en: "After being out in the heat, my body is very hot and I feel confused or about to faint. I need emergency help.",
                zh: "在高温下待了一段时间后，我全身发烫，意识模糊或快要晕倒。我需要急救。",
                ko: "더운 곳에 있다가 몸이 매우 뜨겁고, 정신이 몽롱하거나 쓰러질 것 같아요. 응급 치료가 필요해요.",
                ja: "暑い中にいたあと、体がとても熱く、意識がぼんやりしているか、倒れそうです。緊急の治療が必要です。",
                ru: "После пребывания на жаре тело очень горячее, путаются мысли или я вот-вот потеряю сознание. Мне нужна срочная медицинская помощь.",
                fr: "Après un long moment dans la chaleur, j’ai le corps brûlant, les idées embrouillées ou je sens que je vais m’évanouir. J’ai besoin d’une aide médicale urgente."
              } }
            }
          },
          {
            id: "cold",
            icon: "snowflake",
            label: { vi: "Nhiễm lạnh, hạ thân nhiệt", en: "Cold exposure, hypothermia", zh: "受冻、体温过低", ko: "추위 노출·저체온", ja: "冷え・低体温", ru: "Переохлаждение", fr: "Exposition au froid, hypothermie" },
            phrases: {
              mild: { code: "MOD01-SKIN-10-1", urgent: false, text: {
                vi: "Tôi bị lạnh và run.",
                en: "I am cold and shivering.",
                zh: "我很冷，在发抖。",
                ko: "추워서 몸이 떨려요.",
                ja: "寒くて震えています。",
                ru: "Мне холодно, я дрожу.",
                fr: "J’ai froid et je tremble."
              } },
              moderate: { code: "MOD01-SKIN-10-2", urgent: false, text: {
                vi: "Tôi bị ướt lạnh lâu, run nhiều, tay chân tê cóng.",
                en: "I have been wet and cold for a long time. I am shivering a lot and my hands and feet are numb.",
                zh: "我长时间又湿又冷，抖得很厉害，手脚冻得发麻。",
                ko: "오랫동안 젖은 채 추위에 있어서 심하게 떨리고 손발이 얼어 감각이 없어요.",
                ja: "長い間ぬれて冷えていて、震えが強く、手足がかじかんで感覚がありません。",
                ru: "После долгого пребывания на холоде в мокрой одежде меня сильно трясёт, руки и ноги онемели.",
                fr: "Après des heures dans le froid et l’humidité, je tremble beaucoup et j’ai les mains et les pieds engourdis."
              } },
              severe: { code: "MOD01-SKIN-10-3", urgent: true, text: {
                vi: "Tôi bị lạnh lâu, giờ nói líu, lú lẫn hoặc rất buồn ngủ; có thể đã hết run dù người vẫn lạnh cóng. Tôi cần cấp cứu.",
                en: "I have been cold for a long time; my speech is slurred, I am confused or very drowsy, and I may have stopped shivering although I am still cold. I need emergency help.",
                zh: "我受冻很久了，现在说话含糊、神志不清或非常想睡；可能已经不再发抖，但身体仍然冰冷。我需要急救。",
                ko: "오랫동안 추위에 있어서 말이 꼬이거나, 정신이 혼미하거나, 몹시 졸려요. 몸은 여전히 차가운데 떨림이 멈췄을 수도 있어요. 응급 치료가 필요해요.",
                ja: "長い間冷えていて、ろれつが回らない、頭が混乱している、またはとても眠いです。体は冷たいままなのに、震えが止まっているかもしれません。緊急の治療が必要です。",
                ru: "Я уже давно на холоде: речь заплетается, путаются мысли или сильная сонливость; дрожь могла прекратиться, хотя мне всё ещё холодно. Мне нужна срочная медицинская помощь.",
                fr: "J’ai froid depuis longtemps\u00a0: j’ai du mal à articuler, les idées embrouillées ou très sommeil, et je ne tremble peut-être plus alors que j’ai toujours froid. J’ai besoin d’une aide médicale urgente."
              } }
            }
          }
        ]
      }
    ],

    /* ─── One-tap phrases (outside the tree). urgent:true ⇒ UI styles it red / next to 115. ─── */
    quick: [
      { id: "q-emergency", icon: "siren", urgent: true, text: {
        vi: "Tôi cần cấp cứu. Làm ơn gọi 115 giúp tôi.",
        en: "I need emergency help. Please call 115 for me.",
        zh: "我需要急救。请帮我拨打115。",
        ko: "응급 상황이에요. 115에 전화해 주세요.",
        ja: "緊急です。115に電話してください。",
        ru: "Мне нужна срочная медицинская помощь. Пожалуйста, позвоните 115.",
        fr: "J’ai besoin d’une aide médicale urgente. Appelez le 115, s’il vous plaît."
      } },
      { id: "q-accident", icon: "bike", urgent: true, text: {
        vi: "Tôi bị tai nạn xe máy.",
        en: "I have had a motorbike accident.",
        zh: "我出了摩托车事故。",
        ko: "오토바이 사고를 당했어요.",
        ja: "バイクで事故にあいました。",
        ru: "Со мной произошла авария на мотоцикле.",
        fr: "J’ai eu un accident de moto."
      } },
      { id: "q-no-vietnamese", icon: "languages", text: {
        vi: "Tôi không nói được tiếng Việt.",
        en: "I do not speak Vietnamese.",
        zh: "我不会说越南语。",
        ko: "저는 베트남어를 못해요.",
        ja: "ベトナム語が話せません。",
        ru: "Я не говорю по-вьетнамски.",
        fr: "Je ne parle pas vietnamien."
      } },
      { id: "q-english-speaker", icon: "user", text: {
        vi: "Làm ơn gọi giúp tôi người nói được tiếng Anh.",
        en: "Please find someone who speaks English.",
        zh: "请帮我找一位会说英语的人。",
        ko: "영어를 할 수 있는 사람을 불러 주세요.",
        ja: "英語を話せる人を呼んでください。",
        ru: "Пожалуйста, позовите того, кто говорит по-английски.",
        fr: "S’il vous plaît, appelez quelqu’un qui parle anglais."
      } },
      { id: "q-hospital", icon: "hospital", text: {
        vi: "Làm ơn đưa tôi đến bệnh viện hoặc trạm y tế gần nhất.",
        en: "Please take me to the nearest hospital or health station.",
        zh: "请送我去最近的医院或卫生站。",
        ko: "가장 가까운 병원이나 보건소로 데려다 주세요.",
        ja: "いちばん近い病院か診療所に連れて行ってください。",
        ru: "Пожалуйста, отвезите меня в ближайшую больницу или медпункт.",
        fr: "S’il vous plaît, emmenez-moi à l’hôpital ou au poste de santé le plus proche."
      } },
      /* lead = the staff-facing line shown above the phrase instead of "Người bệnh muốn nói…" (the speaker is not the patient). */
      { id: "q-on-behalf", icon: "users",
        lead: {
          vi: "Người đi cùng người bệnh muốn nói với anh/chị:",
          en: "The patient’s travel companion wants to tell you:",
          zh: "病人的同伴想告诉您：",
          ko: "환자의 일행이 전하는 말이에요:",
          ja: "患者の同行者からお伝えしたいこと：",
          ru: "Спутник пациента хочет сказать вам:",
          fr: "La personne qui accompagne le patient souhaite vous dire\u00a0:"
        },
        text: {
        vi: "Tôi nói thay cho người đi cùng. Người cần giúp đỡ là bạn ấy, không phải tôi.",
        en: "I am speaking for my travel companion. They are the one who needs help, not me.",
        zh: "我在替我的同伴说话，需要帮助的是同伴，不是我。",
        ko: "저는 일행을 대신해 말하고 있어요. 도움이 필요한 사람은 제가 아니라 제 일행이에요.",
        ja: "同行者の代わりに話しています。助けが必要なのは私ではなく同行者です。",
        ru: "Помощь нужна не мне, а человеку, с которым я путешествую. Я говорю от имени этого человека.",
        fr: "Je parle pour la personne qui m’accompagne\u00a0: c’est elle qui a besoin d’aide, pas moi."
      } },
      { id: "q-qr-profile", icon: "qr", text: {
        vi: "Thông tin y tế của tôi có trong mã QR trên điện thoại.",
        en: "My medical information is in the QR code on my phone.",
        zh: "我的医疗信息在手机上的二维码里。",
        ko: "제 의료 정보는 휴대폰의 QR 코드에 있어요.",
        ja: "私の医療情報はスマートフォンのQRコードにあります。",
        ru: "Моя медицинская информация — в QR-коде на телефоне.",
        fr: "Mes informations médicales sont dans le QR code de mon téléphone."
      },
      text_behalf: {
        vi: "Người bệnh có thể có thông tin y tế trong mã QR trên điện thoại của chính họ (không phải điện thoại này).",
        en: "The patient may have their medical information in a QR code on their own phone (not this one).",
        zh: "病人自己的手机上可能有含医疗信息的二维码（不是这部手机）。",
        ko: "환자 본인의 휴대폰에 의료 정보가 담긴 QR 코드가 있을 수 있어요(이 휴대폰이 아니에요).",
        ja: "患者本人のスマートフォンに医療情報のQRコードがあるかもしれません（この端末ではありません）。",
        ru: "Медицинская информация пациента может быть в QR-коде на его собственном телефоне (не на этом).",
        fr: "Le patient a peut-être ses informations médicales dans un QR code sur son propre téléphone (pas celui-ci)."
      } },
      { id: "q-drug-allergy", icon: "pill", text: {
        vi: "Tôi bị dị ứng thuốc. Xin kiểm tra hồ sơ y tế của tôi trước khi cho thuốc.",
        en: "I am allergic to some medicines. Please check my medical profile before giving me any.",
        zh: "我对某些药物过敏。给药前请先查看我的医疗资料。",
        ko: "저는 약물 알레르기가 있어요. 약을 주시기 전에 제 의료 정보를 확인해 주세요.",
        ja: "薬のアレルギーがあります。薬を出す前に私の医療情報を確認してください。",
        ru: "У меня аллергия на лекарства. Пожалуйста, проверьте мою медицинскую информацию, прежде чем давать препараты.",
        fr: "Je suis allergique à certains médicaments. Merci de vérifier mon dossier médical avant de m’en donner."
      },
      text_behalf: {
        vi: "Người bệnh bị dị ứng thuốc. Xin hỏi kỹ hoặc kiểm tra hồ sơ y tế của chính người bệnh trước khi cho thuốc.",
        en: "The patient is allergic to some medicines. Please ask carefully or check the patient’s own medical profile before giving any.",
        zh: "病人对某些药物过敏。给药前请仔细询问，或查看病人本人的医疗资料。",
        ko: "환자는 약물 알레르기가 있어요. 약을 주시기 전에 자세히 물어보시거나 환자 본인의 의료 정보를 확인해 주세요.",
        ja: "患者には薬のアレルギーがあります。薬を出す前に、よく確認するか、患者本人の医療情報を確認してください。",
        ru: "У пациента аллергия на лекарства. Пожалуйста, подробно расспросите или проверьте медицинскую информацию самого пациента, прежде чем давать препараты.",
        fr: "Le patient est allergique à certains médicaments. Merci de bien vérifier, ou de consulter son propre dossier médical, avant de lui en donner."
      } },
      { id: "q-diabetes", icon: "gauge", text: {
        vi: "Tôi bị bệnh tiểu đường.",
        en: "I have diabetes.",
        zh: "我有糖尿病。",
        ko: "저는 당뇨병이 있어요.",
        ja: "糖尿病があります。",
        ru: "У меня сахарный диабет.",
        fr: "Je suis diabétique."
      } },
      { id: "q-pregnant", icon: "heart", text: {
        vi: "Tôi đang mang thai.",
        en: "I am pregnant.",
        zh: "我怀孕了。",
        ko: "저는 임신 중이에요.",
        ja: "妊娠しています。",
        ru: "Я беременна.",
        fr: "Je suis enceinte."
      } },
      { id: "q-pain-here", icon: "hand", text: {
        vi: "Tôi đau ở chỗ này.",
        en: "It hurts here.",
        zh: "我这里疼。",
        ko: "여기가 아파요.",
        ja: "ここが痛いです。",
        ru: "У меня болит вот здесь.",
        fr: "J’ai mal ici."
      } },
      { id: "q-contact-family", icon: "phone-call", text: {
        vi: "Làm ơn liên hệ người thân của tôi. Số điện thoại có trong hồ sơ QR.",
        en: "Please contact my family. The phone number is in my QR profile.",
        zh: "请联系我的家人。电话号码在我的二维码资料里。",
        ko: "제 가족에게 연락해 주세요. 전화번호는 QR 프로필에 있어요.",
        ja: "家族に連絡してください。電話番号はQRプロフィールにあります。",
        ru: "Пожалуйста, свяжитесь с моими близкими. Номер телефона — в моём QR-профиле.",
        fr: "Merci de contacter mes proches. Le numéro est dans mon profil QR."
      },
      text_behalf: {
        vi: "Làm ơn liên hệ người thân của người bệnh. Số điện thoại có thể có trong hồ sơ QR trên điện thoại của chính người bệnh.",
        en: "Please contact the patient’s family. The number may be in the QR profile on the patient’s own phone.",
        zh: "请联系病人的家人。电话号码可能在病人自己手机上的二维码资料里。",
        ko: "환자의 가족에게 연락해 주세요. 전화번호는 환자 본인 휴대폰의 QR 프로필에 있을 수 있어요.",
        ja: "患者の家族に連絡してください。電話番号は患者本人のスマートフォンのQRプロフィールにあるかもしれません。",
        ru: "Пожалуйста, свяжитесь с близкими пациента. Номер может быть в QR-профиле на телефоне самого пациента.",
        fr: "Merci de contacter les proches du patient. Le numéro se trouve peut-être dans le profil QR sur son propre téléphone."
      } },
      { id: "q-lost", icon: "compass", text: {
        vi: "Tôi bị lạc đường. Làm ơn giúp tôi.",
        en: "I am lost. Please help me.",
        zh: "我迷路了，请帮帮我。",
        ko: "길을 잃었어요. 도와주세요.",
        ja: "道に迷いました。助けてください。",
        ru: "Я не могу найти дорогу. Пожалуйста, помогите.",
        fr: "J’ai perdu mon chemin. Aidez-moi, s’il vous plaît."
      } },
      { id: "q-water-food", icon: "droplet", text: {
        vi: "Tôi cần nước uống và đồ ăn.",
        en: "I need drinking water and food.",
        zh: "我需要饮用水和食物。",
        ko: "마실 물과 음식이 필요해요.",
        ja: "飲み水と食べ物が必要です。",
        ru: "Мне нужны питьевая вода и еда.",
        fr: "J’ai besoin d’eau potable et de nourriture."
      } },
      { id: "q-insurance", icon: "shield-check", text: {
        vi: "Tôi có bảo hiểm du lịch.",
        en: "I have travel insurance.",
        zh: "我有旅行保险。",
        ko: "여행자 보험이 있어요.",
        ja: "旅行保険に入っています。",
        ru: "У меня есть туристическая страховка.",
        fr: "J’ai une assurance voyage."
      } },
      { id: "q-tap-question", icon: "help-circle", text: {
        vi: "Làm ơn chạm vào câu hỏi trên màn hình này để hỏi tôi.",
        en: "Please tap a question on this screen to ask me.",
        zh: "请点这个屏幕上的问题来问我。",
        ko: "이 화면에서 질문을 눌러서 저에게 물어봐 주세요.",
        ja: "この画面の質問をタップして、私に聞いてください。",
        ru: "Пожалуйста, нажмите на вопрос на этом экране, чтобы спросить меня.",
        fr: "Touchez une question sur cet écran pour me la poser, s’il vous plaît."
      } }
    ],

    /* ─── Staff mode: questions local medical staff ask (Vietnamese source) + answers the traveler taps. ─── */
    staff: [
      { id: "st-where", text: {
          vi: "Bạn đau ở đâu?", en: "Where does it hurt?", zh: "您哪里疼？", ko: "어디가 아프세요?",
          ja: "どこが痛みますか？", ru: "Где у вас болит?", fr: "Où avez-vous mal ?" },
        answers: [
          { id: "head", text: { vi: "Đầu", en: "Head", zh: "头", ko: "머리", ja: "頭", ru: "Голова", fr: "La tête" } },
          { id: "neck", text: { vi: "Cổ", en: "Neck", zh: "脖子", ko: "목", ja: "首", ru: "Шея", fr: "Le cou" } },
          { id: "chest", text: { vi: "Ngực", en: "Chest", zh: "胸口", ko: "가슴", ja: "胸", ru: "Грудь", fr: "La poitrine" } },
          { id: "abdomen", text: { vi: "Bụng", en: "Abdomen / belly", zh: "肚子", ko: "배", ja: "お腹", ru: "Живот", fr: "Le ventre" } },
          { id: "back", text: { vi: "Lưng", en: "Back", zh: "背部", ko: "등·허리", ja: "背中・腰", ru: "Спина", fr: "Le dos" } },
          { id: "arm", text: { vi: "Tay", en: "Arm or hand", zh: "手臂或手", ko: "팔이나 손", ja: "腕か手", ru: "Рука", fr: "Le bras ou la main" } },
          { id: "leg", text: { vi: "Chân", en: "Leg or foot", zh: "腿或脚", ko: "다리나 발", ja: "脚か足", ru: "Нога", fr: "La jambe ou le pied" } },
          { id: "all", text: { vi: "Khắp người", en: "All over", zh: "全身", ko: "온몸", ja: "全身", ru: "Везде", fr: "Partout" } }
        ] },
      { id: "st-since", text: {
          vi: "Bạn bị như vậy từ khi nào?", en: "When did this start?", zh: "您从什么时候开始这样的？", ko: "언제부터 그러셨어요?",
          ja: "いつからですか？", ru: "Когда это началось?", fr: "Depuis quand avez-vous ces symptômes ?" },
        answers: [
          { id: "minutes", text: { vi: "Vài phút trước", en: "A few minutes ago", zh: "几分钟前", ko: "몇 분 전", ja: "数分前", ru: "Несколько минут назад", fr: "Il y a quelques minutes" } },
          { id: "hour", text: { vi: "Khoảng 1 giờ trước", en: "About an hour ago", zh: "大约一小时前", ko: "한 시간쯤 전", ja: "1時間ほど前", ru: "Около часа назад", fr: "Il y a environ une heure" } },
          { id: "hours", text: { vi: "Vài giờ trước", en: "A few hours ago", zh: "几个小时前", ko: "몇 시간 전", ja: "数時間前", ru: "Несколько часов назад", fr: "Il y a quelques heures" } },
          { id: "yesterday", text: { vi: "Từ hôm qua", en: "Since yesterday", zh: "从昨天开始", ko: "어제부터", ja: "昨日から", ru: "Со вчерашнего дня", fr: "Depuis hier" } },
          { id: "days", text: { vi: "Vài ngày nay", en: "For a few days", zh: "这几天一直这样", ko: "며칠 전부터", ja: "数日前から", ru: "Уже несколько дней", fr: "Depuis quelques jours" } },
          { id: "week", text: { vi: "Hơn một tuần", en: "More than a week", zh: "一个多星期了", ko: "일주일 넘게", ja: "1週間以上前から", ru: "Больше недели", fr: "Depuis plus d’une semaine" } }
        ] },
      { id: "st-pain-scale", text: {
          vi: "Bạn đau mức nào, từ 0 (không đau) đến 10 (đau nhất)?",
          en: "How bad is the pain, from 0 (no pain) to 10 (worst pain)?",
          zh: "您的疼痛有多严重？从0（不痛）到10（最痛）。",
          ko: "통증이 어느 정도예요? 0(안 아픔)부터 10(가장 아픔)까지 골라 주세요.",
          ja: "痛みはどのくらいですか？0（痛みなし）から10（最もひどい痛み）で選んでください。",
          ru: "Насколько сильная боль, от 0 (нет боли) до 10 (самая сильная)?",
          fr: "Quelle est l’intensité de la douleur, de 0 (aucune douleur) à 10 (la pire douleur) ?" },
        answers: [
          { id: "p0", text: { vi: "0 – Không đau", en: "0 – No pain", zh: "0 – 不痛", ko: "0 – 안 아픔", ja: "0 – 痛みなし", ru: "0 – Нет боли", fr: "0 – Aucune douleur" } },
          { id: "p1", text: { vi: "1", en: "1", zh: "1", ko: "1", ja: "1", ru: "1", fr: "1" } },
          { id: "p2", text: { vi: "2", en: "2", zh: "2", ko: "2", ja: "2", ru: "2", fr: "2" } },
          { id: "p3", text: { vi: "3", en: "3", zh: "3", ko: "3", ja: "3", ru: "3", fr: "3" } },
          { id: "p4", text: { vi: "4", en: "4", zh: "4", ko: "4", ja: "4", ru: "4", fr: "4" } },
          { id: "p5", text: { vi: "5 – Đau vừa", en: "5 – Moderate", zh: "5 – 中等", ko: "5 – 중간", ja: "5 – 中くらい", ru: "5 – Средняя", fr: "5 – Modérée" } },
          { id: "p6", text: { vi: "6", en: "6", zh: "6", ko: "6", ja: "6", ru: "6", fr: "6" } },
          { id: "p7", text: { vi: "7", en: "7", zh: "7", ko: "7", ja: "7", ru: "7", fr: "7" } },
          { id: "p8", text: { vi: "8", en: "8", zh: "8", ko: "8", ja: "8", ru: "8", fr: "8" } },
          { id: "p9", text: { vi: "9", en: "9", zh: "9", ko: "9", ja: "9", ru: "9", fr: "9" } },
          { id: "p10", text: { vi: "10 – Đau nhất", en: "10 – Worst pain", zh: "10 – 最痛", ko: "10 – 가장 아픔", ja: "10 – 最もひどい", ru: "10 – Сильнейшая", fr: "10 – La pire" } }
        ] },
      { id: "st-head-hit", text: {
          vi: "Bạn có bị ngã hoặc va đập vào đầu không?", en: "Did you fall or hit your head?", zh: "您有没有摔倒或撞到头？",
          ko: "넘어지거나 머리를 부딪치셨어요?", ja: "転んだり、頭を打ったりしましたか？", ru: "Вы падали или ударялись головой?",
          fr: "Avez-vous fait une chute ou reçu un coup à la tête ?" },
        answers: [
          { id: "hit-head", text: { vi: "Có, bị va vào đầu", en: "Yes, I hit my head", zh: "有，撞到了头", ko: "네, 머리를 부딪쳤어요", ja: "はい、頭を打ちました", ru: "Да, был удар по голове", fr: "Oui, j’ai reçu un coup à la tête" } },
          { id: "fell-no-head", text: { vi: "Có ngã nhưng không va đầu", en: "I fell but did not hit my head", zh: "摔倒了，但没撞到头", ko: "넘어졌지만 머리는 안 부딪쳤어요", ja: "転びましたが、頭は打っていません", ru: "Было падение, но без удара головой", fr: "J’ai fait une chute, sans coup à la tête" } },
          { id: "no", text: { vi: "Không", en: "No", zh: "没有", ko: "아니요", ja: "いいえ", ru: "Нет", fr: "Non" } },
          { id: "dont-remember", text: { vi: "Tôi không nhớ", en: "I don’t remember", zh: "我不记得了", ko: "기억이 안 나요", ja: "覚えていません", ru: "Не помню", fr: "Je ne m’en souviens pas" } }
        ] },
      { id: "st-conscious", text: {
          vi: "Bạn có bị ngất hoặc mất ý thức không?", en: "Did you faint or lose consciousness?", zh: "您有没有晕倒或失去意识？",
          ko: "기절하거나 의식을 잃으셨어요?", ja: "気を失ったり、意識がなくなったりしましたか？", ru: "Вы теряли сознание?",
          fr: "Avez-vous perdu connaissance ?" },
        answers: [
          { id: "yes", text: { vi: "Có", en: "Yes", zh: "有", ko: "네", ja: "はい", ru: "Да", fr: "Oui" } },
          { id: "no", text: { vi: "Không", en: "No", zh: "没有", ko: "아니요", ja: "いいえ", ru: "Нет", fr: "Non" } },
          { id: "unsure", text: { vi: "Tôi không chắc", en: "I’m not sure", zh: "我不确定", ko: "잘 모르겠어요", ja: "よくわかりません", ru: "Не знаю точно", fr: "Je ne sais pas" } }
        ] },
      { id: "st-move", text: {
          vi: "Bạn có cử động được chỗ bị đau không?", en: "Can you move the painful part?", zh: "您疼的地方能活动吗？",
          ko: "아픈 부위를 움직일 수 있어요?", ja: "痛いところを動かせますか？", ru: "Можете пошевелить больным местом?",
          fr: "Pouvez-vous bouger la partie douloureuse ?" },
        answers: [
          { id: "normal", text: { vi: "Có, bình thường", en: "Yes, normally", zh: "能，活动正常", ko: "네, 평소처럼 움직여요", ja: "はい、普通に動かせます", ru: "Да, нормально", fr: "Oui, normalement" } },
          { id: "painful", text: { vi: "Được, nhưng rất đau", en: "Yes, but it hurts a lot", zh: "能，但是很疼", ko: "움직일 수는 있지만 많이 아파요", ja: "動かせますが、とても痛いです", ru: "Да, но очень больно", fr: "Oui, mais j’ai très mal" } },
          { id: "cannot", text: { vi: "Không cử động được", en: "No, I can’t move it", zh: "不能活动", ko: "움직일 수 없어요", ja: "動かせません", ru: "Нет, не могу", fr: "Non, je ne peux pas" } },
          { id: "numb", text: { vi: "Bị tê, mất cảm giác", en: "It is numb, I can’t feel it", zh: "发麻，没有感觉", ko: "저리고 감각이 없어요", ja: "しびれて感覚がありません", ru: "Онемело, не чувствую", fr: "C’est engourdi, je ne sens plus rien" } }
        ] },
      { id: "st-allergy", text: {
          vi: "Bạn có dị ứng thuốc hoặc thức ăn nào không?", en: "Are you allergic to any medicine or food?", zh: "您对什么药物或食物过敏吗？",
          ko: "약이나 음식에 알레르기가 있으세요?", ja: "薬や食べ物のアレルギーはありますか？", ru: "У вас есть аллергия на лекарства или продукты?",
          fr: "Êtes-vous allergique à un médicament ou à un aliment ?" },
        answers: [
          { id: "none", text: { vi: "Không", en: "No", zh: "没有", ko: "없어요", ja: "ありません", ru: "Нет", fr: "Non" } },
          { id: "see-qr", text: { vi: "Có – xem hồ sơ QR của tôi", en: "Yes – see my QR profile", zh: "有，请看我的二维码资料", ko: "있어요 – 제 QR 프로필을 봐 주세요", ja: "あります。QRプロフィールを見てください", ru: "Да – смотрите мой QR-профиль", fr: "Oui – voir mon profil QR" } },
          { id: "antibiotics", text: { vi: "Kháng sinh (penicillin…)", en: "Antibiotics (penicillin…)", zh: "抗生素（青霉素等）", ko: "항생제(페니실린 등)", ja: "抗生物質（ペニシリンなど）", ru: "Антибиотики (пенициллин и др.)", fr: "Antibiotiques (pénicilline…)" } },
          { id: "painkillers", text: { vi: "Thuốc giảm đau (aspirin, ibuprofen)", en: "Painkillers (aspirin, ibuprofen)", zh: "止痛药（阿司匹林、布洛芬）", ko: "진통제(아스피린, 이부프로펜)", ja: "痛み止め（アスピリン、イブプロフェン）", ru: "Обезболивающие (аспирин, ибупрофен)", fr: "Antidouleurs (aspirine, ibuprofène)" } },
          { id: "seafood", text: { vi: "Hải sản", en: "Seafood", zh: "海鲜", ko: "해산물", ja: "魚介類", ru: "Морепродукты", fr: "Fruits de mer" } },
          { id: "nuts", text: { vi: "Đậu phộng, các loại hạt", en: "Peanuts or nuts", zh: "花生或坚果", ko: "땅콩·견과류", ja: "ピーナッツ・ナッツ類", ru: "Арахис, орехи", fr: "Arachides, fruits à coque" } },
          { id: "unknown", text: { vi: "Tôi không biết", en: "I don’t know", zh: "我不知道", ko: "모르겠어요", ja: "わかりません", ru: "Не знаю", fr: "Je ne sais pas" } }
        ] },
      { id: "st-medications", text: {
          vi: "Bạn có đang dùng thuốc gì không?", en: "Are you taking any medicines?", zh: "您现在在服用什么药吗？",
          ko: "지금 복용 중인 약이 있으세요?", ja: "今飲んでいる薬はありますか？", ru: "Вы сейчас принимаете какие-либо лекарства?",
          fr: "Prenez-vous des médicaments en ce moment ?" },
        answers: [
          { id: "none", text: { vi: "Không", en: "No", zh: "没有", ko: "없어요", ja: "ありません", ru: "Нет", fr: "Non" } },
          { id: "see-qr", text: { vi: "Có – xem hồ sơ QR của tôi", en: "Yes – see my QR profile", zh: "有，请看我的二维码资料", ko: "있어요 – 제 QR 프로필을 봐 주세요", ja: "あります。QRプロフィールを見てください", ru: "Да – смотрите мой QR-профиль", fr: "Oui – voir mon profil QR" } },
          { id: "anticoagulant", text: { vi: "Thuốc chống đông máu", en: "Blood thinners", zh: "抗凝血药", ko: "항응고제(혈액 응고 억제제)", ja: "血液をサラサラにする薬（抗凝固薬）", ru: "Препараты, разжижающие кровь", fr: "Anticoagulants" } },
          { id: "insulin", text: { vi: "Insulin, thuốc tiểu đường", en: "Insulin or diabetes medicine", zh: "胰岛素或降糖药", ko: "인슐린·당뇨약", ja: "インスリン・糖尿病の薬", ru: "Инсулин или препараты от диабета", fr: "Insuline ou médicament contre le diabète" } },
          { id: "inhaler", text: { vi: "Thuốc xịt hen", en: "Asthma inhaler", zh: "哮喘吸入剂", ko: "천식 흡입기", ja: "ぜんそくの吸入薬", ru: "Ингалятор от астмы", fr: "Inhalateur contre l’asthme" } },
          { id: "heart", text: { vi: "Thuốc tim mạch, huyết áp", en: "Heart or blood pressure medicine", zh: "心脏病药或降压药", ko: "심장약·혈압약", ja: "心臓・血圧の薬", ru: "Лекарства для сердца или от давления", fr: "Médicaments pour le cœur ou la tension" } },
          { id: "contraceptive", text: { vi: "Thuốc tránh thai", en: "Contraceptive pill", zh: "避孕药", ko: "피임약", ja: "避妊薬（ピル）", ru: "Противозачаточные таблетки", fr: "Pilule contraceptive" } }
        ] },
      { id: "st-conditions", text: {
          vi: "Bạn có bệnh nền nào không?", en: "Do you have any long-term medical conditions?", zh: "您有什么基础疾病吗？",
          ko: "지병이 있으세요?", ja: "持病はありますか？", ru: "У вас есть хронические заболевания?",
          fr: "Avez-vous une maladie chronique ?" },
        answers: [
          { id: "none", text: { vi: "Không", en: "No", zh: "没有", ko: "없어요", ja: "ありません", ru: "Нет", fr: "Non" } },
          { id: "see-qr", text: { vi: "Có – xem hồ sơ QR của tôi", en: "Yes – see my QR profile", zh: "有，请看我的二维码资料", ko: "있어요 – 제 QR 프로필을 봐 주세요", ja: "あります。QRプロフィールを見てください", ru: "Да – смотрите мой QR-профиль", fr: "Oui – voir mon profil QR" } },
          { id: "asthma", text: { vi: "Hen suyễn", en: "Asthma", zh: "哮喘", ko: "천식", ja: "ぜんそく", ru: "Астма", fr: "Asthme" } },
          { id: "diabetes", text: { vi: "Tiểu đường", en: "Diabetes", zh: "糖尿病", ko: "당뇨병", ja: "糖尿病", ru: "Диабет", fr: "Diabète" } },
          { id: "heart", text: { vi: "Bệnh tim", en: "Heart disease", zh: "心脏病", ko: "심장병", ja: "心臓病", ru: "Болезнь сердца", fr: "Maladie cardiaque" } },
          { id: "hypertension", text: { vi: "Tăng huyết áp", en: "High blood pressure", zh: "高血压", ko: "고혈압", ja: "高血圧", ru: "Гипертония", fr: "Hypertension" } },
          { id: "epilepsy", text: { vi: "Động kinh", en: "Epilepsy", zh: "癫痫", ko: "뇌전증(간질)", ja: "てんかん", ru: "Эпилепсия", fr: "Épilepsie" } }
        ] },
      { id: "st-pregnant", text: {
          vi: "Bạn có đang mang thai không?", en: "Are you pregnant?", zh: "您怀孕了吗？", ko: "임신 중이세요?",
          ja: "妊娠していますか？", ru: "Вы беременны?", fr: "Êtes-vous enceinte ?" },
        answers: [
          { id: "yes", text: { vi: "Có", en: "Yes", zh: "是的", ko: "네", ja: "はい", ru: "Да", fr: "Oui" } },
          { id: "no", text: { vi: "Không", en: "No", zh: "没有", ko: "아니요", ja: "いいえ", ru: "Нет", fr: "Non" } },
          { id: "maybe", text: { vi: "Có thể", en: "Possibly", zh: "有可能", ko: "그럴 수도 있어요", ja: "可能性があります", ru: "Возможно", fr: "C’est possible" } },
          { id: "na", text: { vi: "Không áp dụng", en: "Not applicable", zh: "不适用", ko: "해당 없음", ja: "該当しません", ru: "Не применимо", fr: "Sans objet" } }
        ] },
      { id: "st-food", text: {
          vi: "Trong 24 giờ qua bạn đã ăn hoặc uống gì?", en: "What have you eaten or drunk in the last 24 hours?",
          zh: "过去24小时内您吃了或喝了什么？", ko: "지난 24시간 동안 무엇을 먹거나 마셨어요?",
          ja: "この24時間に何を食べたり飲んだりしましたか？", ru: "Что вы ели или пили за последние 24 часа?",
          fr: "Qu’avez-vous mangé ou bu ces dernières 24 heures ?" },
        answers: [
          { id: "seafood", text: { vi: "Hải sản", en: "Seafood", zh: "海鲜", ko: "해산물", ja: "魚介類", ru: "Морепродукты", fr: "Des fruits de mer" } },
          { id: "street-food", text: { vi: "Đồ ăn đường phố", en: "Street food", zh: "街边小吃", ko: "길거리 음식", ja: "屋台の食べ物", ru: "Уличная еда", fr: "De la cuisine de rue" } },
          { id: "alcohol", text: { vi: "Rượu (kể cả rượu tự nấu)", en: "Alcohol (including home-made rice liquor)", zh: "酒（包括自酿米酒）", ko: "술(집에서 빚은 술 포함)", ja: "お酒（自家製の米の酒を含む）", ru: "Алкоголь (в том числе домашняя рисовая водка)", fr: "De l’alcool (y compris de l’alcool de riz artisanal)" } },
          { id: "unsafe-water", text: { vi: "Nước chưa đun sôi, nước suối", en: "Unboiled or stream water", zh: "没烧开的水或溪水", ko: "끓이지 않은 물·계곡물", ja: "沸かしていない水・沢の水", ru: "Некипячёная или речная вода", fr: "De l’eau non bouillie ou de ruisseau" } },
          { id: "wild-food", text: { vi: "Nấm hoặc cây rừng", en: "Wild mushrooms or plants", zh: "野生蘑菇或野生植物", ko: "야생 버섯·식물", ja: "野生のキノコ・植物", ru: "Дикие грибы или растения", fr: "Des champignons ou plantes sauvages" } },
          { id: "nothing-unusual", text: { vi: "Không có gì bất thường", en: "Nothing unusual", zh: "没吃什么特别的", ko: "특별한 건 없어요", ja: "特に変わったものはありません", ru: "Ничего необычного", fr: "Rien d’inhabituel" } }
        ] },
      { id: "st-tetanus", text: {
          vi: "Bạn đã tiêm phòng uốn ván chưa?", en: "Have you had a tetanus vaccine?", zh: "您打过破伤风疫苗吗？",
          ko: "파상풍 예방접종을 받으셨어요?", ja: "破傷風の予防接種は受けていますか？", ru: "Вы делали прививку от столбняка?",
          fr: "Avez-vous déjà reçu un vaccin contre le tétanos ?" },
        answers: [
          { id: "within-5y", text: { vi: "Có, trong vòng 5 năm", en: "Yes, within the last 5 years", zh: "打过，5年以内", ko: "네, 5년 이내에 맞았어요", ja: "はい、5年以内に受けました", ru: "Да, в последние 5 лет", fr: "Oui, il y a moins de 5 ans" } },
          { id: "over-5y", text: { vi: "Có, hơn 5 năm trước", en: "Yes, more than 5 years ago", zh: "打过，但已超过5年", ko: "네, 5년도 더 전에 맞았어요", ja: "はい、5年以上前です", ru: "Да, больше 5 лет назад", fr: "Oui, il y a plus de 5 ans" } },
          { id: "never", text: { vi: "Chưa tiêm", en: "No, never", zh: "没打过", ko: "아니요, 안 맞았어요", ja: "受けていません", ru: "Нет, никогда", fr: "Non, jamais" } },
          { id: "dont-remember", text: { vi: "Tôi không nhớ", en: "I don’t remember", zh: "我不记得了", ko: "기억이 안 나요", ja: "覚えていません", ru: "Не помню", fr: "Je ne m’en souviens pas" } }
        ] },
      { id: "st-rabies", text: {
          vi: "Bạn đã tiêm phòng dại trước chuyến đi chưa?", en: "Did you have a rabies vaccine before your trip?",
          zh: "您出行前打过狂犬疫苗吗？", ko: "여행 전에 광견병 예방접종을 받으셨어요?",
          ja: "旅行の前に狂犬病の予防接種を受けましたか？", ru: "Вы делали прививку от бешенства перед поездкой?",
          fr: "Avez-vous reçu le vaccin contre la rage avant votre voyage ?" },
        answers: [
          { id: "full", text: { vi: "Có, đã tiêm đủ liều", en: "Yes, the full course", zh: "打过，已打完全程", ko: "네, 전부 맞았어요", ja: "はい、すべて受けました", ru: "Да, полный курс", fr: "Oui, le schéma complet" } },
          { id: "no", text: { vi: "Chưa", en: "No", zh: "没有", ko: "아니요", ja: "いいえ", ru: "Нет", fr: "Non" } },
          { id: "dont-remember", text: { vi: "Tôi không nhớ", en: "I don’t remember", zh: "我不记得了", ko: "기억이 안 나요", ja: "覚えていません", ru: "Не помню", fr: "Je ne m’en souviens pas" } }
        ] }
    ],

    /* ─── Sentence templates filled from the MOD.03 public profile ("{x}" = user value, escape before HTML). ─── */
    templates: {
      blood: {
        vi: "Nhóm máu của tôi là {x}.",
        en: "My blood type is {x}.",
        zh: "我的血型是{x}。",
        ko: "제 혈액형: {x}.",
        ja: "私の血液型は{x}です。",
        ru: "Моя группа крови: {x}.",
        fr: "Mon groupe sanguin est {x}."
      },
      allergy: {
        vi: "Tôi bị dị ứng với: {x}.",
        en: "I am allergic to: {x}.",
        zh: "我对以下物质过敏：{x}。",
        ko: "저는 다음에 알레르기가 있어요: {x}.",
        ja: "次のものにアレルギーがあります：{x}。",
        ru: "У меня аллергия на: {x}.",
        fr: "Je suis allergique à : {x}."
      },
      condition: {
        vi: "Tôi có bệnh nền: {x}.",
        en: "I have these medical conditions: {x}.",
        zh: "我有以下基础疾病：{x}。",
        ko: "다음 지병이 있어요: {x}.",
        ja: "次の持病があります：{x}。",
        ru: "У меня есть заболевания: {x}.",
        fr: "J’ai les problèmes de santé suivants : {x}."
      },
      medication: {
        vi: "Tôi đang dùng thuốc: {x}.",
        en: "I am taking these medicines: {x}.",
        zh: "我正在服用以下药物：{x}。",
        ko: "지금 다음 약을 먹고 있어요: {x}.",
        ja: "次の薬を服用しています：{x}。",
        ru: "Я принимаю лекарства: {x}.",
        fr: "Je prends les médicaments suivants : {x}."
      },
      /* No-slot variants, used when the MOD.03 value is "Không có / None" (or the blood type is unknown). */
      allergy_none: {
        vi: "Tôi không có dị ứng nào đã biết.",
        en: "I have no known allergies.",
        zh: "我没有已知的过敏。",
        ko: "알려진 알레르기가 없어요.",
        ja: "わかっているアレルギーはありません。",
        ru: "Известных аллергий у меня нет.",
        fr: "Je n’ai aucune allergie connue."
      },
      condition_none: {
        vi: "Tôi không có bệnh nền nào đã biết.",
        en: "I have no known long-term medical conditions.",
        zh: "我没有已知的基础疾病。",
        ko: "알려진 지병이 없어요.",
        ja: "わかっている持病はありません。",
        ru: "Известных хронических заболеваний у меня нет.",
        fr: "Je n’ai aucune maladie chronique connue."
      },
      medication_none: {
        vi: "Tôi không dùng thuốc nào thường xuyên.",
        en: "I am not taking any regular medicines.",
        zh: "我没有长期服用的药物。",
        ko: "평소에 먹는 약이 없어요.",
        ja: "普段飲んでいる薬はありません。",
        ru: "Я не принимаю никаких лекарств постоянно.",
        fr: "Je ne prends aucun médicament régulièrement."
      },
      blood_unknown: {
        vi: "Tôi không biết nhóm máu của mình.",
        en: "I do not know my blood type.",
        zh: "我不知道自己的血型。",
        ko: "제 혈액형을 몰라요.",
        ja: "自分の血液型はわかりません。",
        ru: "Я не знаю свою группу крови.",
        fr: "Je ne connais pas mon groupe sanguin."
      }
    },

    /* Terminology source for MOD.01 (PDF bảng PL.3 #4). The team has not fixed the edition yet, so year stays
       null (the UI shows "năm: đang chốt / year: to be fixed") — never invent one. Same record as NC_FIRSTAID 'vrc'. */
    sources: [
      {
        id: "vrc", short: "Hội CTĐ Việt Nam", short_en: "Viet Nam Red Cross", year: null,
        title: "Tài liệu huấn luyện sơ cấp cứu – Hội Chữ thập đỏ Việt Nam",
        title_en: "First-aid training materials – Viet Nam Red Cross Society",
        scope: {
          vi: "Chuẩn hoá thuật ngữ tiếng Việt cho các câu MOD.01.",
          en: "Standard Vietnamese terminology for the MOD.01 phrases."
        }
      }
    ]
  };

  /**
   * Look up a tree phrase by its code (e.g. "MOD01-HEAD-01-3"). Linear scan (~120 phrases), no cache,
   * so it always reflects the current data.
   * The result can be used directly as the phrase P ({code, urgent, text}) and also carries its tree context.
   * @param {string} code
   * @returns {{code:string, urgent:boolean, text:Object, phrase:Object, severity:('mild'|'moderate'|'severe'),
   *            group:Object, symptom:Object, child:(Object|null)}|null}  null when the code is unknown
   */
  function find(code) {
    var groups = NC_PHRASES.groups;
    for (var g = 0; g < groups.length; g++) {
      var symptoms = groups[g].symptoms;
      for (var s = 0; s < symptoms.length; s++) {
        var sym = symptoms[s];
        var leaves = sym.children ? sym.children : [sym];
        for (var c = 0; c < leaves.length; c++) {
          var ph = leaves[c].phrases;
          for (var sev in ph) {
            if (Object.prototype.hasOwnProperty.call(ph, sev) && ph[sev].code === code) {
              var p = ph[sev];
              return {
                code: p.code, urgent: p.urgent, text: p.text, phrase: p, severity: sev,
                group: groups[g], symptom: sym, child: sym.children ? leaves[c] : null
              };
            }
          }
        }
      }
    }
    return null;
  }

  // Non-enumerable so the object stays "pure data" for JSON/iteration.
  Object.defineProperty(NC_PHRASES, 'find', { value: find, enumerable: false, configurable: true, writable: true });

  /* MOD.01 body-group glyphs that the shell sprite (core/icons.js) does not ship. Lucide-style 24×24,
     stroke-only; registered once via the public NC.icons.add() and never overriding an existing name. */
  var EXTRA_ICONS = {
    // Torso outline with rib line + navel → "Bụng / Abdomen"
    'abdomen': '<path d="M7.5 3c0 2.6-2.5 4.4-2.5 8.5 0 4 1.6 6.9 2.8 9.5"/><path d="M16.5 3c0 2.6 2.5 4.4 2.5 8.5 0 4-1.6 6.9-2.8 9.5"/><path d="M8.5 9.5c2.3 1.3 4.7 1.3 7 0"/><circle cx="12" cy="14.5" r="1"/>',
    // Lucide "person-standing" (ISC) → "Da & toàn thân / Skin & whole body"
    'person-standing': '<circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/>',
    // Bottle with a warning bar → "Ngộ độc / Poisoning" (same glyph as NC_FIRSTAID's; whichever file loads first registers it)
    'bottle': '<path d="M10 2h4"/><path d="M10.5 2v4.2L8.3 8.6A3 3 0 0 0 7.5 10.7V20a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-9.3a3 3 0 0 0-.8-2.1l-2.2-2.4V2"/><path d="M7.5 12h9"/><path d="M12 14.5V17"/><path d="M12 19.5h.01"/>'
  };
  var NC = root.NC;
  if (NC && NC.icons && typeof NC.icons.add === 'function' && typeof NC.icons.has === 'function') {
    Object.keys(EXTRA_ICONS).forEach(function (name) {
      if (!NC.icons.has(name)) NC.icons.add(name, EXTRA_ICONS[name]);
    });
  }

  root.NC_PHRASES = NC_PHRASES;
  if (typeof module !== 'undefined' && module.exports) module.exports = NC_PHRASES;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
