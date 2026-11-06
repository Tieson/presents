// npm run vapid → keys for Web Push (put them into the environment / config.php)
import { generateVapidKeys } from "../server/push.js";
const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=mailto:tvuj@email.cz`);
