// backup/get-refresh-token.mjs
// Запускается ОДИН РАЗ локально, чтобы получить refresh-токен Google Drive.
// Нужен файл oauth_client.json (OAuth-клиент типа "Desktop app", скачанный из Google Cloud).
//   node get-refresh-token.mjs
// Откроется (или нужно открыть вручную) ссылка, ты подтверждаешь доступ —
// в терминал печатается REFRESH TOKEN. Его кладёшь в секрет GOOGLE_REFRESH_TOKEN.
import http from 'node:http';
import fs from 'node:fs';
import { google } from 'googleapis';

const PORT = 5555;
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const raw = JSON.parse(fs.readFileSync('./oauth_client.json', 'utf8'));
const cfg = raw.installed || raw.web;
if (!cfg) { console.error('oauth_client.json не похож на OAuth-клиент. Скачай клиент типа "Desktop app".'); process.exit(1); }

const oauth = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, `http://localhost:${PORT}`);
const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const code = u.searchParams.get('code');
  if (!code) { res.end('Нет кода авторизации.'); return; }
  try {
    const { tokens } = await oauth.getToken(code);
    res.end('Готово. Можно закрыть вкладку и вернуться в терминал.');
    console.log('\n================= REFRESH TOKEN =================\n');
    console.log(tokens.refresh_token || '(нет refresh_token — повтори с другим аккаунтом или удали доступ в myaccount.google.com и попробуй снова)');
    console.log('\n================================================\n');
  } catch (e) {
    res.end('Ошибка обмена кода: ' + e.message);
    console.error(e);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('Открой эту ссылку в браузере и подтверди доступ:\n');
  console.log(url + '\n');
});
