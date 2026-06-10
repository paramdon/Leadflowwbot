const TelegramBot = require("node-telegram-bot-api");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const cron = require("node-cron");
const axios = require("axios");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error("❌ BOT_TOKEN nahi mili!"); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });

const adapter = new FileSync("db.json");
const db = low(adapter);
db.defaults({ leads: [] }).write();

const CATEGORIES = {
  salon: { emoji: "💈", label: "Salon", hindiName: "salon" },
  restaurant: { emoji: "🍽️", label: "Restaurant", hindiName: "restaurant" },
  clinic: { emoji: "🏥", label: "Clinic", hindiName: "clinic" },
  construction: { emoji: "🏗️", label: "Construction", hindiName: "construction company" },
};

const STATUSES = {
  new: "🆕 New", sent: "📤 Pitch Sent", replied: "💬 Replied",
  interested: "🔥 Interested", followup: "🔔 Follow Up",
  converted: "✅ Converted", dead: "❌ Not Interested",
};

function getPitch(category, name) {
  const pitches = {
    salon: `Namaste! 🙏\n\n*${name}* ke liye ek kaam ki baat —\n\nAajkal customers pehle Google karte hain, phir jaate hain. Online booking nahi hoti toh competitor ke paas chale jaate hain.\n\nMain 4 din mein bana deta hoon:\n→ Professional website\n→ Automatic booking system\n→ WhatsApp notification jab bhi koi appointment le\n\nStarting sirf ₹8,000 setup + ₹1,500/month\n\nAapka ek *free demo* ready hai — dekhoge? 😊`,
    restaurant: `Namaste! 🙏\n\n*${name}* ke liye ek important baat —\n\nZomato/Swiggy har order pe 25-30% commission le raha hai. Yeh aapka hi paisa hai.\n\nMain bana deta hoon:\n→ Aapki khud ki ordering website\n→ QR code — customers seedha order karein\n→ Zero commission — 100% profit aapka\n\nSetup sirf ₹10,000 + ₹1,500/month\n\nFree demo ready hai — dekhoge? 😊`,
    clinic: `Namaste! 🙏\n\n*${name}* ke liye ek useful cheez —\n\nBar bar phone calls aate hain appointment ke liye?\n\nMain setup kar deta hoon:\n→ Online appointment booking\n→ Patients khud time book karein WhatsApp pe\n→ Automatic reminders — no-shows kam\n→ Professional clinic website\n\nSirf ₹8,000 + ₹1,500/month\n\nFree demo ready hai — dekhoge? 😊`,
    construction: `Namaste! 🙏\n\n*${name}* ke liye ek kaam ki baat —\n\nBuyers online dhundte hain pehle. Agar aap wahan nahi hain toh opportunity miss ho rahi hai.\n\nMain bana deta hoon:\n→ Project showcase website\n→ Lead capture — buyers seedha aapke paas\n→ WhatsApp pe instant notification\n\nSirf ₹12,000 + ₹2,000/month\n\nFree demo ready hai — dekhoge? 😊`,
  };
  return pitches[category] || pitches.salon;
}

function getFollowup(category, name) {
  const msgs = {
    salon: `Namaste! 🙏\n\n${name} ke liye jo demo banaya tha — abhi bhi available hai.\n\nBas 5 minute mein dikhata hoon, pasand aaye toh aage, warna koi baat nahi. 🙂\n\nKab free ho aap?`,
    restaurant: `Namaste! 🙏\n\n${name} ke liye commission bachane wala demo abhi bhi ready hai.\n\nEk baar dekhlo — 5 minute ka kaam hai. Kab milein? 🙂`,
    clinic: `Namaste! 🙏\n\n${name} ke liye appointment automation demo abhi bhi available hai.\n\nKab 5 minute milenge? 🙂`,
    construction: `Namaste! 🙏\n\n${name} project ke liye jo demo banaya tha — buyers aane shuru ho sakte hain.\n\nEk baar dekhlo? Kab free ho? 🙂`,
  };
  return msgs[category] || msgs.salon;
}

// ─── Google Places Search ─────────────────────────────────────────
async function searchBusinesses(category, city) {
  const PLACES_KEY = process.env.GOOGLE_PLACES_KEY;
  const query = `${CATEGORIES[category].hindiName} in ${city} India`;

  if (PLACES_KEY) {
    try {
      const res = await axios.get("https://maps.googleapis.com/maps/api/place/textsearch/json", {
        params: { query, key: PLACES_KEY, language: "en" }
      });
      return res.data.results.slice(0, 8).map(p => ({
        name: p.name,
        address: p.formatted_address,
        rating: p.rating || "N/A",
        mapsUrl: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
        placeId: p.place_id,
      }));
    } catch (e) {
      console.error("Places API error:", e.message);
    }
  }

  // Fallback — Google Maps search link
  return [{ fallback: true, query, city, category }];
}

function makeWhatsAppLink(phone, message) {
  const clean = phone.replace(/\D/g, "");
  const num = clean.startsWith("91") ? clean : `91${clean}`;
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${num}?text=${encoded}`;
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 4); }
function formatDate(iso) { if (!iso) return "Never"; return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); }

const userState = {};
function setState(id, s) { userState[id] = s; }
function getState(id) { return userState[id] || null; }
function clearState(id) { delete userState[id]; }

// ─── Main Menu ────────────────────────────────────────────────────
function sendMainMenu(chatId) {
  const leads = db.get("leads").value();
  const followupsDue = leads.filter(l => {
    if (!["sent","followup"].includes(l.status) || !l.lastContact) return false;
    return (Date.now() - new Date(l.lastContact)) / 86400000 >= 3;
  }).length;

  bot.sendMessage(chatId,
    `🎯 *LeadFlow Bot*\n\n` +
    `📊 *Stats:*\n` +
    `├ Total Leads: ${leads.length}\n` +
    `├ Interested: ${leads.filter(l=>l.status==="interested").length} 🔥\n` +
    `├ Converted: ${leads.filter(l=>l.status==="converted").length} ✅\n` +
    `└ Follow-ups Due: ${followupsDue} 🔔\n\nKya karna hai?`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
      [{ text: "🔍 Leads Dhundo + Pitch", callback_data: "find_leads" }],
      [{ text: "➕ Manual Lead Add", callback_data: "add_lead" }, { text: "📋 My Leads", callback_data: "list_leads" }],
      [{ text: "🔔 Follow-ups", callback_data: "followups" }, { text: "📊 Stats", callback_data: "stats" }],
    ]}}
  );
}

bot.onText(/\/start/, msg => { clearState(msg.chat.id); sendMainMenu(msg.chat.id); });
bot.onText(/\/menu/, msg => { clearState(msg.chat.id); sendMainMenu(msg.chat.id); });

// ─── /find shortcut command ───────────────────────────────────────
// Usage: /find salon Mumbai
bot.onText(/\/find (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const parts = match[1].trim().split(" ");
  const category = parts[0].toLowerCase();
  const city = parts.slice(1).join(" ");

  if (!CATEGORIES[category]) {
    bot.sendMessage(chatId, "❌ Category sahi nahi hai.\n\nUse: `/find salon Mumbai`\nCategories: salon, restaurant, clinic, construction", { parse_mode: "Markdown" });
    return;
  }
  if (!city) {
    bot.sendMessage(chatId, "❌ City bhi likho.\n\nExample: `/find salon Mumbai`", { parse_mode: "Markdown" });
    return;
  }

  await doFindLeads(chatId, category, city);
});

// ─── Callback Handler ─────────────────────────────────────────────
bot.on("callback_query", async query => {
  const chatId = query.message.chat.id;
  const data = query.data;
  bot.answerCallbackQuery(query.id);

  // ── Find Leads Flow ──
  if (data === "find_leads") {
    setState(chatId, { step: "find_category" });
    bot.sendMessage(chatId, "🔍 *Leads Dhundo*\n\nKaun sa business dhundna hai?", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        [{ text: "💈 Salon", callback_data: "find_cat_salon" }, { text: "🍽️ Restaurant", callback_data: "find_cat_restaurant" }],
        [{ text: "🏥 Clinic", callback_data: "find_cat_clinic" }, { text: "🏗️ Construction", callback_data: "find_cat_construction" }],
      ]}
    });
    return;
  }

  if (data.startsWith("find_cat_")) {
    const category = data.replace("find_cat_", "");
    setState(chatId, { step: "find_city", category });
    bot.sendMessage(chatId, `${CATEGORIES[category].emoji} *${CATEGORIES[category].label}*\n\nKaun si city mein dhundna hai?\n\nCity ka naam likho (e.g. Mumbai, Delhi, Pune):`, { parse_mode: "Markdown" });
    return;
  }

  // ── Add Lead Manual ──
  if (data === "add_lead") {
    setState(chatId, { step: "add_category" });
    bot.sendMessage(chatId, "Kaun sa business hai?", { reply_markup: { inline_keyboard: [
      [{ text: "💈 Salon", callback_data: "cat_salon" }, { text: "🍽️ Restaurant", callback_data: "cat_restaurant" }],
      [{ text: "🏥 Clinic", callback_data: "cat_clinic" }, { text: "🏗️ Construction", callback_data: "cat_construction" }],
    ]}});
    return;
  }

  if (data.startsWith("cat_")) {
    const category = data.replace("cat_", "");
    setState(chatId, { step: "add_name", category });
    bot.sendMessage(chatId, `${CATEGORIES[category].emoji} Business ka naam likho:`, { parse_mode: "Markdown" });
    return;
  }

  // ── Pitch from found lead (before saving) ──
  if (data.startsWith("quickpitch_")) {
    // Format: quickpitch_CATEGORY_ENCODEDNAME
    const parts = data.split("_");
    const category = parts[1];
    const name = decodeURIComponent(parts.slice(2).join("_"));
    const pitch = getPitch(category, name);

    bot.sendMessage(chatId,
      `📤 *Pitch Ready — ${name}*\n\n` +
      `Copy karo aur WhatsApp pe bhejo 👇\n\n` +
      `\`\`\`\n${pitch}\n\`\`\`\n\n` +
      `📱 *Phone number add karke WhatsApp button banao:*`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "📱 Phone Number Add Karo → WhatsApp Button", callback_data: `addphone_${category}_${encodeURIComponent(name)}` }],
          [{ text: "⬅️ Back", callback_data: "find_leads" }],
        ]}
      }
    );
    return;
  }

  // ── Add phone to get WhatsApp button ──
  if (data.startsWith("addphone_")) {
    const parts = data.split("_");
    const category = parts[1];
    const name = decodeURIComponent(parts.slice(2).join("_"));
    setState(chatId, { step: "add_phone_for_wa", category, name });
    bot.sendMessage(chatId, `📱 *${name}* ka WhatsApp number likho:\n\n(Format: 9876543210)`, { parse_mode: "Markdown" });
    return;
  }

  // ── WhatsApp Direct Open ──
  if (data.startsWith("wa_")) {
    const id = data.replace("wa_", "");
    const lead = db.get("leads").find({ id }).value();
    if (!lead) return;
    const pitch = getPitch(lead.category, lead.name);
    const waLink = makeWhatsAppLink(lead.phone, pitch);
    bot.sendMessage(chatId,
      `✅ *${lead.name}* ke liye pitch ready!\n\nNeeche button dabao — WhatsApp khulega pre-filled message ke saath 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "📱 WhatsApp Pe Bhejo ✅", url: waLink }],
          [{ text: "🔔 Follow-up Message", callback_data: `fup_${id}` }],
          [{ text: "✅ Converted", callback_data: `setstatus_converted_${id}` }, { text: "🔥 Interested", callback_data: `setstatus_interested_${id}` }],
          [{ text: "⬅️ Back", callback_data: `lead_${id}` }],
        ]}
      }
    );
    db.get("leads").find({ id }).assign({ status: "sent", lastContact: new Date().toISOString() }).write();
    return;
  }

  // ── Follow-up WhatsApp ──
  if (data.startsWith("wafup_")) {
    const id = data.replace("wafup_", "");
    const lead = db.get("leads").find({ id }).value();
    if (!lead) return;
    const msg = getFollowup(lead.category, lead.name);
    const waLink = makeWhatsAppLink(lead.phone, msg);
    bot.sendMessage(chatId,
      `🔔 *Follow-up — ${lead.name}*\n\nButton dabao — WhatsApp khulega 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "📱 WhatsApp Follow-up Bhejo ✅", url: waLink }],
          [{ text: "✅ Converted", callback_data: `setstatus_converted_${id}` }, { text: "❌ Dead", callback_data: `setstatus_dead_${id}` }],
          [{ text: "⬅️ Back", callback_data: `lead_${id}` }],
        ]}
      }
    );
    db.get("leads").find({ id }).assign({ status: "followup", lastContact: new Date().toISOString() }).write();
    return;
  }

  if (data === "list_leads") { showLeadsList(chatId, "all", 0); return; }
  if (data.startsWith("leads_cat_")) { showLeadsList(chatId, data.replace("leads_cat_",""), 0); return; }
  if (data.startsWith("leads_page_")) {
    const parts = data.split("_");
    showLeadsList(chatId, parts[2], parseInt(parts[3]));
    return;
  }
  if (data.startsWith("lead_")) { showLeadDetail(chatId, data.replace("lead_","")); return; }

  if (data.startsWith("setstatus_")) {
    const parts = data.split("_");
    const status = parts[1];
    const id = parts.slice(2).join("_");
    db.get("leads").find({ id }).assign({ status, lastContact: new Date().toISOString() }).write();
    bot.sendMessage(chatId, `✅ Status updated: *${STATUSES[status]}*`, { parse_mode: "Markdown" });
    showLeadDetail(chatId, id);
    return;
  }

  if (data.startsWith("fup_")) {
    const id = data.replace("fup_","");
    const lead = db.get("leads").find({ id }).value();
    if (!lead) return;
    const msg = getFollowup(lead.category, lead.name);
    const waLink = makeWhatsAppLink(lead.phone, msg);
    bot.sendMessage(chatId,
      `🔔 *Follow-up — ${lead.name}*`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "📱 WhatsApp Pe Bhejo ✅", url: waLink }],
          [{ text: "⬅️ Back", callback_data: `lead_${id}` }],
        ]}
      }
    );
    return;
  }

  if (data === "followups") { showFollowups(chatId); return; }
  if (data === "stats") { showStats(chatId); return; }
  if (data === "menu") { clearState(chatId); sendMainMenu(chatId); return; }
});

// ─── Message Handler ──────────────────────────────────────────────
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;
  const state = getState(chatId);
  if (!state) return;

  // Find leads — city step
  if (state.step === "find_city") {
    clearState(chatId);
    await doFindLeads(chatId, state.category, text.trim());
    return;
  }

  // Manual add — name
  if (state.step === "add_name") {
    setState(chatId, { ...state, step: "add_phone", name: text.trim() });
    bot.sendMessage(chatId, `👍 *${text.trim()}*\n\nPhone number likho (WhatsApp wala):`, { parse_mode: "Markdown" });
    return;
  }

  // Manual add — phone
  if (state.step === "add_phone") {
    const lead = { id: genId(), name: state.name, phone: text.trim(), category: state.category, status: "new", addedAt: new Date().toISOString(), lastContact: null, notes: "" };
    db.get("leads").push(lead).write();
    clearState(chatId);
    const waLink = makeWhatsAppLink(text.trim(), getPitch(state.category, state.name));
    bot.sendMessage(chatId,
      `✅ *Lead Added!*\n\n${CATEGORIES[state.category].emoji} *${state.name}*\n📱 ${text.trim()}`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "📱 WhatsApp Pe Pitch Bhejo ✅", url: waLink }],
        [{ text: "📋 All Leads", callback_data: "list_leads" }, { text: "🏠 Menu", callback_data: "menu" }],
      ]}}
    );
    return;
  }

  // Add phone for WhatsApp button (from found lead)
  if (state.step === "add_phone_for_wa") {
    const phone = text.trim();
    const lead = { id: genId(), name: state.name, phone, category: state.category, status: "new", addedAt: new Date().toISOString(), lastContact: null, notes: "" };
    db.get("leads").push(lead).write();
    clearState(chatId);
    const waLink = makeWhatsAppLink(phone, getPitch(state.category, state.name));
    bot.sendMessage(chatId,
      `✅ *${state.name}* saved!\n\nAb pitch bhejo — button dabao 👇`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "📱 WhatsApp Pe Pitch Bhejo ✅", url: waLink }],
          [{ text: "🔍 Aur Leads Dhundo", callback_data: "find_leads" }, { text: "🏠 Menu", callback_data: "menu" }],
        ]}
      }
    );
    db.get("leads").find({ id: lead.id }).assign({ status: "sent", lastContact: new Date().toISOString() }).write();
    return;
  }
});

// ─── Core: Find Leads Function ────────────────────────────────────
async function doFindLeads(chatId, category, city) {
  const cat = CATEGORIES[category];
  const searching = await bot.sendMessage(chatId, `🔍 *${cat.emoji} ${cat.label}* dhundh raha hoon *${city}* mein...\n\nEk second ruko...`, { parse_mode: "Markdown" });

  const results = await searchBusinesses(category, city);

  if (results[0] && results[0].fallback) {
    // No API key — give Google Maps search links
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(cat.hindiName + " in " + city + " India")}`;
    bot.sendMessage(chatId,
      `🔍 *${cat.emoji} ${cat.label} in ${city}*\n\n` +
      `Google Maps pe yeh businesses dhundo, number note karo, phir bot mein add karo:\n\n` +
      `👇 Neeche link dabao:`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: `🗺️ Google Maps Pe Dekho`, url: searchUrl }],
          [{ text: "➕ Lead Manually Add Karo", callback_data: "add_lead" }],
          [{ text: "🏠 Menu", callback_data: "menu" }],
        ]}
      }
    );
    return;
  }

  // Got results — show each business with pitch + maps button
  let text = `✅ *${results.length} ${cat.label} mile — ${city}*\n\nHar business ke liye:\n1️⃣ Maps link se number dekho\n2️⃣ Pitch button se message copy karo\n3️⃣ Phone add karo → WhatsApp button milega\n\n`;

  const buttons = [];

  results.forEach((biz, i) => {
    text += `*${i+1}. ${biz.name}*\n`;
    text += `📍 ${biz.address ? biz.address.substring(0, 60) + "..." : city}\n`;
    text += `⭐ Rating: ${biz.rating}\n\n`;

    const nameEncoded = encodeURIComponent(biz.name);
    buttons.push([
      { text: `🗺️ ${i+1}. Maps`, url: biz.mapsUrl },
      { text: `📤 Pitch`, callback_data: `quickpitch_${category}_${nameEncoded}` },
    ]);
  });

  buttons.push([{ text: "🔍 Aur Dhundo (Doosri City)", callback_data: "find_leads" }]);
  buttons.push([{ text: "🏠 Menu", callback_data: "menu" }]);

  bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
}

// ─── Leads List ───────────────────────────────────────────────────
function showLeadsList(chatId, category, page) {
  const all = db.get("leads").value();
  const filtered = category === "all" ? all : all.filter(l => l.category === category);
  const pageSize = 5;
  const total = filtered.length;
  const start = page * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  if (total === 0) {
    bot.sendMessage(chatId, "📋 Koi lead nahi hai!\n\n🔍 Leads dhundo ya ➕ manually add karo.", {
      reply_markup: { inline_keyboard: [
        [{ text: "🔍 Leads Dhundo", callback_data: "find_leads" }],
        [{ text: "➕ Add Lead", callback_data: "add_lead" }, { text: "🏠 Menu", callback_data: "menu" }],
      ]}
    });
    return;
  }

  let text = `📋 *Leads* (${start+1}-${Math.min(start+pageSize, total)} of ${total})\n\n`;
  paginated.forEach((l, i) => {
    text += `${start+i+1}. ${CATEGORIES[l.category].emoji} *${l.name}*\n   📱 ${l.phone} | ${STATUSES[l.status]}\n\n`;
  });

  const buttons = paginated.map(l => [{ text: `${CATEGORIES[l.category].emoji} ${l.name}`, callback_data: `lead_${l.id}` }]);
  const nav = [];
  if (page > 0) nav.push({ text: "⬅️", callback_data: `leads_page_${category}_${page-1}` });
  if (start + pageSize < total) nav.push({ text: "➡️", callback_data: `leads_page_${category}_${page+1}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "💈", callback_data: "leads_cat_salon" }, { text: "🍽️", callback_data: "leads_cat_restaurant" }, { text: "🏥", callback_data: "leads_cat_clinic" }, { text: "🏗️", callback_data: "leads_cat_construction" }]);
  buttons.push([{ text: "🏠 Menu", callback_data: "menu" }]);

  bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
}

// ─── Lead Detail ──────────────────────────────────────────────────
function showLeadDetail(chatId, id) {
  const lead = db.get("leads").find({ id }).value();
  if (!lead) { bot.sendMessage(chatId, "Lead nahi mila!"); return; }
  const cat = CATEGORIES[lead.category];

  bot.sendMessage(chatId,
    `${cat.emoji} *${lead.name}*\n\n📱 ${lead.phone}\n📊 Status: ${STATUSES[lead.status]}\n📅 Added: ${formatDate(lead.addedAt)}\n🕐 Last Contact: ${formatDate(lead.lastContact)}`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
      [{ text: "📱 WhatsApp Pitch ✅", callback_data: `wa_${id}` }],
      [{ text: "🔔 WhatsApp Follow-up", callback_data: `wafup_${id}` }],
      [{ text: "🔥 Interested", callback_data: `setstatus_interested_${id}` }, { text: "✅ Converted", callback_data: `setstatus_converted_${id}` }],
      [{ text: "💬 Replied", callback_data: `setstatus_replied_${id}` }, { text: "❌ Dead", callback_data: `setstatus_dead_${id}` }],
      [{ text: "⬅️ Back", callback_data: "list_leads" }],
    ]}}
  );
}

// ─── Follow-ups ───────────────────────────────────────────────────
function showFollowups(chatId) {
  const due = db.get("leads").value().filter(l => {
    if (!["sent","followup"].includes(l.status) || !l.lastContact) return false;
    return (Date.now() - new Date(l.lastContact)) / 86400000 >= 3;
  });

  if (due.length === 0) {
    bot.sendMessage(chatId, "✅ *Sab clear!*\n\nKoi follow-up due nahi hai.", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🏠 Menu", callback_data: "menu" }]] }});
    return;
  }

  bot.sendMessage(chatId, `🔔 *${due.length} Follow-ups Due!*\n\nKis ko ping karna hai?`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [
      ...due.slice(0,8).map(l => [{ text: `${CATEGORIES[l.category].emoji} ${l.name} — WhatsApp`, callback_data: `wafup_${l.id}` }]),
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ]}
  });
}

// ─── Stats ────────────────────────────────────────────────────────
function showStats(chatId) {
  const leads = db.get("leads").value();
  const conv = leads.filter(l=>l.status==="converted").length;
  const todaySent = leads.filter(l => l.lastContact && new Date(l.lastContact).toDateString()===new Date().toDateString() && l.status==="sent").length;

  let text = `📊 *LeadFlow Stats*\n\n🎯 Total: ${leads.length}\n📤 Today Sent: ${todaySent}/20\n\n*Status:*\n`;
  Object.entries(STATUSES).forEach(([k,v]) => {
    const c = leads.filter(l=>l.status===k).length;
    if (c > 0) text += `${v}: ${c}\n`;
  });
  text += `\n💰 Est. Revenue: ₹${(conv*8000/1000).toFixed(0)}K\n📈 Conv. Rate: ${leads.length > 0 ? ((conv/leads.length)*100).toFixed(1) : 0}%`;

  bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🏠 Menu", callback_data: "menu" }]] }});
}

// ─── Daily Reminder 9 AM IST ──────────────────────────────────────
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
if (ADMIN_CHAT_ID) {
  cron.schedule("30 3 * * *", () => {
    const due = db.get("leads").value().filter(l => {
      if (!["sent","followup"].includes(l.status) || !l.lastContact) return false;
      return (Date.now() - new Date(l.lastContact)) / 86400000 >= 3;
    });
    if (due.length > 0) {
      bot.sendMessage(ADMIN_CHAT_ID, `🌅 *Good Morning!*\n\n🔔 ${due.length} follow-ups due hain aaj!\n\n/menu pe jao.`, { parse_mode: "Markdown" });
    }
  });
}

bot.on("polling_error", err => console.error("Error:", err.message));
console.log("🚀 LeadFlow Bot chal raha hai...");
