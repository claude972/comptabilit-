// Compare une instance Keycloak d'ESSAI (restaurée depuis un export) au Keycloak local d'origine et à la base de
// l'application. N'écrit dans aucune des deux instances. N'affiche jamais un mot de passe, un jeton ni un secret.
import { readFileSync } from 'node:fs';

for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const royaume = process.env.ROYAUME;
const origine = new URL(process.env.OIDC_ISSUER).origin;
const essai = process.env.ESSAI_KC_URL;
if (!essai || new URL(essai).host === new URL(origine).host) throw new Error('Instance d’essai non décrite, ou identique à l’origine.');

const echecs = [];
const verifier = (condition, libelle) => {
  if (!condition) echecs.push(libelle);
  console.log(`${condition ? 'conforme' : 'ÉCHEC   '} — ${libelle}`);
};

async function jeton(base, royaumeCible, corps) {
  const r = await fetch(`${base}/realms/${royaumeCible}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams(corps) });
  return { statut: r.status, json: await r.json().catch(() => ({})) };
}
const sujetDe = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;
const connexion = (base, email, motDePasse) => jeton(base, royaume, { grant_type: 'password', client_id: 'comtaple-tests', username: email, password: motDePasse, scope: 'openid' });

async function admin(base, utilisateur, motDePasse) {
  const j = await jeton(base, 'master', { grant_type: 'password', client_id: 'admin-cli', username: utilisateur, password: motDePasse });
  if (!j.json.access_token) throw new Error(`Administration indisponible sur ${base} (HTTP ${j.statut})`);
  return async (chemin) => (await fetch(`${base}/admin/realms/${royaume}${chemin}`, { headers: { authorization: `Bearer ${j.json.access_token}` } })).json();
}

// Comptes connus de la base de l'application : « e-mail sujet » par ligne.
const attendus = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '));
const lireOrigine = await admin(origine, process.env.KC_ADMIN_USER, process.env.KC_ADMIN_PASSWORD);
const lireEssai = await admin(essai, process.env.ESSAI_KC_ADMIN, process.env.ESSAI_KC_MDP);

const [comptesOrigine, comptesEssai] = [await lireOrigine('/users?max=1000'), await lireEssai('/users?max=1000')];
const cle = (u) => `${u.id} ${u.username} ${u.email ?? ''} ${u.enabled}`;
verifier(comptesOrigine.length > 0 && comptesOrigine.length === comptesEssai.length, `nombre de comptes identique (${comptesEssai.length})`);
verifier(JSON.stringify(comptesOrigine.map(cle).sort()) === JSON.stringify(comptesEssai.map(cle).sort()), 'identifiants, noms, e-mails et états des comptes identiques');

let connexionsVerifiees = 0;
for (const [email, sujetBase] of attendus) {
  const compte = comptesEssai.find((u) => u.email === email || u.username === email);
  if (!compte) continue; // compte de la base sans équivalent Keycloak (créé par un essai, accès support…) : compté plus bas
  const [o, e] = [await connexion(origine, email, process.env.DEV_MDP_UTILISATEURS), await connexion(essai, email, process.env.DEV_MDP_UTILISATEURS)];
  if (!o.json.access_token) continue; // mot de passe de développement non applicable à ce compte
  const ok = Boolean(e.json.access_token) && sujetDe(e.json.access_token) === sujetDe(o.json.access_token) && sujetDe(e.json.access_token) === sujetBase;
  verifier(ok, `${email} : connexion acceptée par l'instance restaurée, même « sub » que l'origine et que la base de l'application`);
  const refus = await connexion(essai, email, `${process.env.DEV_MDP_UTILISATEURS}-faux`);
  verifier([400, 401].includes(refus.statut) && refus.json.error === 'invalid_grant' && !refus.json.access_token, `${email} : mauvais mot de passe refusé par l'instance restaurée`);
  connexionsVerifiees++;
}
verifier(connexionsVerifiees >= 5, `connexions vérifiées de bout en bout : ${connexionsVerifiees}`);
const sansEquivalent = attendus.filter(([email]) => !comptesEssai.some((u) => u.email === email || u.username === email)).length;
console.log(`information — comptes de la base de l'application sans compte Keycloak : ${sansEquivalent} (comptes créés par des essais, non concernés par la restauration)`);

const [clientsOrigine, clientsEssai] = [await lireOrigine('/clients?max=1000'), await lireEssai('/clients?max=1000')];
const resume = (c) => `${c.clientId} ${c.publicClient} ${c.directAccessGrantsEnabled} ${c.standardFlowEnabled} ${JSON.stringify([...(c.redirectUris ?? [])].sort())}`;
verifier(JSON.stringify(clientsOrigine.map(resume).sort()) === JSON.stringify(clientsEssai.map(resume).sort()), `clients identiques (${clientsEssai.length}) : type, flux et adresses de retour`);
const secret = async (lire, clients) => (await lire(`/clients/${clients.find((c) => c.clientId === 'comtaple-web').id}/client-secret`)).value;
const [secretOrigine, secretEssai] = [await secret(lireOrigine, clientsOrigine), await secret(lireEssai, clientsEssai)];
verifier(Boolean(secretEssai) && secretEssai === secretOrigine && secretEssai === process.env.OIDC_CLIENT_SECRET, 'secret du client confidentiel identique à l’origine et à la configuration de l’application');
const roles = async (lire) => (await lire('/roles?max=1000')).map((r) => r.name).sort();
verifier(JSON.stringify(await roles(lireOrigine)) === JSON.stringify(await roles(lireEssai)), 'rôles du royaume identiques');

if (echecs.length) process.exit(1);
