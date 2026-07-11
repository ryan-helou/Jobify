// Helper for wiring up Telegram notifications. Two modes, picked automatically:
//
//   TELEGRAM_BOT_TOKEN set, TELEGRAM_CHAT_ID not
//     → prints the chat id of whoever has messaged the bot (send it "hi" first),
//       so you can copy it into the second secret.
//
//   both set
//     → sends a test message, proving the token + chat id + bot-started chain works
//       before you rely on it for the every-2-hour refresh.
//
// Run:  node scripts/telegram-setup.js   (reads .env like the rest of the app)
import '../src/config.js'; // loads .env into process.env

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const chatId = process.env.TELEGRAM_CHAT_ID || '';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather, then put the token in .env.');
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.json());

if (!chatId) {
  console.log('No TELEGRAM_CHAT_ID yet. Send your bot any message in Telegram, then re-run this.\n');
  const data = await api('getUpdates');
  if (!data.ok) {
    console.error('getUpdates failed:', JSON.stringify(data));
    process.exit(1);
  }
  const chats = new Map();
  for (const u of data.result || []) {
    const c = u.message?.chat || u.channel_post?.chat;
    if (c) chats.set(c.id, [c.first_name, c.last_name, c.username && `@${c.username}`].filter(Boolean).join(' '));
  }
  if (!chats.size) {
    console.log('No messages seen yet. Open Telegram, find your bot, press Start / send "hi", then re-run.');
    process.exit(0);
  }
  console.log('Chat ids that have messaged your bot:');
  for (const [id, who] of chats) console.log(`  ${id}  (${who || 'unknown'})`);
  console.log('\nSet the right one:  gh secret set TELEGRAM_CHAT_ID   (and add it to .env to test)');
  process.exit(0);
}

const res = await api('sendMessage', {
  chat_id: chatId,
  text: '✅ Jobify is connected. You will get a ping here when new postings land on the board.',
});
if (res.ok) console.log(`Sent a test message to chat ${chatId}. Check Telegram.`);
else console.error('sendMessage failed:', JSON.stringify(res));
process.exit(res.ok ? 0 : 1);
