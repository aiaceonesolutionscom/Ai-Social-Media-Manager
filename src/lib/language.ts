export type LangCode = 'ur' | 'hi' | 'ar' | 'en'

// Lightweight heuristic language detection. Order matters: script checks first
// (Arabic/Urdu and Devanagari are unambiguous), then Roman Urdu/Hindi keywords.
export function detectLanguage(text: string): LangCode {
  if (!text) return 'en'
  const t = text.trim()
  if (/[\u0600-\u06FF]/.test(t)) return 'ar'
  if (/[\u0900-\u097F]/.test(t)) return 'hi'
  if (/\b(meri|mere|mujhe|kya|kia|ka|ki|hai|hain|hota|karta|karti|karne|aap|tum|apne|bhi|na|nhi|nahi|toh|to|wala|wali|banana|banane|karna|kar|daal|dal|laga|lagao|hoo|hoye|ji|haan|han|theek|sahi|konsi|konsa|kis|kaunsa)\b/i.test(t)) return 'ur'
  return 'en'
}

// Static multilingual replies used on the WhatsApp channel so common smalltalk
// and micro-prompts cost ZERO LLM calls (cheap fast-path). Webchat users get the
// full LLM-generated replies instead (ChatGPT-style).
export const STATIC_REPLIES: Record<string, Record<LangCode, string>> = {
  greeting: {
    ur: 'السلام علیکم! 👋 آج آپ کیا بنانا چاہیں گے؟',
    hi: 'नमस्ते! 👋 आज आप क्या बनाना चाहेंगे?',
    ar: 'السلام عليكم! 👋 ماذا تريد أن تنشئ اليوم؟',
    en: 'Hi! 👋 What would you like to create today?',
  },
  thanks: {
    ur: 'Khush aamdeed! 😊 Bataiye aap kis bare mein post banana chahte hain aur main bana deta hoon.',
    hi: 'Aapka swagat hai! 😊 Bataiye aap kis cheez ke baare mein post banana chahte hain aur main bana deta hoon.',
    ar: 'أهلاً بك! 😊 أخبرني ما الذي تريد نشره وسأنشئه لك.',
    en: 'You are welcome! 😊 Just tell me what you want to post about and I will create it for you.',
  },
  farewell: {
    ur: 'Allah hafiz! 👋 Jab bhi post banana ho, message kar dena.',
    hi: 'Alvida! 👋 Jab bhi post banana ho, message kar dena.',
    ar: 'مع السلامة! 👋 راسلني متى أردت إنشاء منشور.',
    en: 'Goodbye! 👋 Message me anytime you want to create a post.',
  },
  whatToPost: {
    ur: 'Theek hai! Aap kis bare mein post banana chahte hain?',
    hi: 'Theek hai! Aap kis cheez ke baare mein post banana chahte ho?',
    ar: 'حسناً! عن ماذا تريد أن تنشئ منشوراً؟',
    en: 'Got it! What would you like to post about?',
  },
  unclear: {
    ur: 'Mazrat, main poori tarah samajh nahi paya. Zara dobara bataiye?',
    hi: 'Maaf kijiye, main theek se samajh nahi paya. Kripya dobara batayein?',
    ar: 'عذراً، لم أفهم تماماً. هل يمكنك إعادة الصياغة؟',
    en: "Sorry, I didn't quite catch that. Could you rephrase?",
  },
  glitch: {
    ur: 'Mazrat, meri taraf se kuch masla hua. Zara dobara bataiye?',
    hi: 'Maaf kijiye, meri taraf se kuch samasya hui. Kripya dobara batayein?',
    ar: 'عذراً، حدث خطأ من جهتي. هل يمكنك إعادة المحاولة؟',
    en: 'Sorry, something glitched on my side. Could you say that again?',
  },
  notFound: {
    ur: 'Post nahi mila. Dobara shuru karein, please.',
    hi: 'Post nahi mila. Kripya dobara shuru karein.',
    ar: 'لم يتم العثور على المنشور. يرجى البدء من جديد.',
    en: 'Post not found. Please start over.',
  },
  processing: {
    ur: '🤖 Abhi main aapki post par kaam kar raha hoon — ek lamba saath rahye!',
    hi: '🤖 Main abhi aapke post par kaam kar raha hoon — ek kshan ruk jayein!',
    ar: '🤖 ما زلت أعمل على منشورك — لحظة من فضلك!',
    en: '🤖 I am still working on your post — one moment!',
  },
  regenerating: {
    ur: '🔄 Aapki post dobara bana raha hoon...',
    hi: '🔄 Aapke post ko phir se bana raha hoon...',
    ar: '🔄 أعيد إنشاء منشورك...',
    en: '🔄 Regenerating your post...',
  },
  brandingAdd: {
    ur: 'Zyada maza aaya! 🎨 Main aapki branding (logo, colors, voice) is post par laga raha hoon.',
    hi: 'Bahut badhiya! 🎨 Main aapki branding (logo, colors, voice) is post par laga raha hoon.',
    ar: 'رائع! 🎨 سأضيف علامتك التجارية (الشعار، الألوان، الصوت) إلى هذا المنشور.',
    en: "Great! I'll add your branding (logo, colors, voice) to this post. 🎨",
  },
  brandingSkip: {
    ur: 'Theek hai! Is post par branding nahi lagaunga.',
    hi: 'Theek hai! Is post par branding nahi lagaunga.',
    ar: 'حسناً! لن أضيف العلامة التجارية لهذا المنشور.',
    en: "Got it! I'll skip branding for this post.",
  },
  approveRequest: {
    ur: "Yeh raha aapka draft. Publish karne ke liye 'Approve' likhein, ya bata dijiye kya badalna hai.",
    hi: "Yeh raha aapka draft. Publish karne ke liye 'Approve' likhein, ya bata dijiye kya badalna hai.",
    ar: 'هذا هو مسودتك. اكتب "موافق" للنشر، أو أخبرني بما تريد تغييره.',
    en: "Here's your draft. Reply Approve to publish, or tell me what to change.",
  },
  tooLate: {
    ur: 'Aapka post publish ke liye bheja ja chuka hai aur ab cancel nahi ho sakta.',
    hi: 'Aapka post publish ke liye bheja ja chuka hai aur ab cancel nahi ho sakta.',
    ar: 'تم إرسال منشورك للنشر ولم يعد بالإمكان إلغاؤه.',
    en: 'Your post has already been sent for publishing and can no longer be cancelled.',
  },
  noPublishing: {
    ur: 'Filhaal koi publishing process nahi chal rahi.',
    hi: 'Filhaal koi publishing process nahi chal rahi.',
    ar: 'لا توجد عملية نشر جارية حالياً.',
    en: 'No publishing is currently in progress.',
  },
  editPrompt: {
    ur: '✏️ Aap kya badalna chahte hain? Masalan: chhota karo, colors badlo, Urdu mein likho, emojis add karo, hashtags hatao, thoda funny banao.',
    hi: '✏️ Aap kya badalna chahte hain? Masalan: chhota karo, colors badlo, Hindi mein likho, emojis add karo, hashtags hatao, thoda funny banao.',
    ar: '✏️ ماذا تريد أن تغير؟ مثلاً: اجعلها أقصر، غيّر الألوان، اكتب بالعربية، أضف رموزاً تعبيرية، أزل الوسوم، اجعلها مضحكة.',
    en: '✏️ What would you like to change? For example: make it shorter, change the colors, use Urdu, add emojis, remove hashtags, make it funnier.',
  },
  generating: {
    ur: 'Great! Main aapke liye ye bana raha hoon. 🎨',
    hi: 'Great! Main aapke liye ye bana raha hoon. 🎨',
    ar: 'رائع! سأنشئه لك. 🎨',
    en: 'Great! Let me create that for you. 🎨',
  },
}

export function staticReply(key: keyof typeof STATIC_REPLIES, lang: LangCode = 'en'): string {
  const table = STATIC_REPLIES[key]
  if (!table) return ''
  // Roman Urdu detection is imperfect; default greeting keeps a light touch by
  // preferring 'ur' when the message is Roman Urdu and we only have script forms.
  return table[lang] ?? table.en
}