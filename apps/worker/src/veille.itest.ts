/**
 * Surveillance des sources : PostgreSQL réel, lecture HTTP INJECTÉE (aucune requête vers l'extérieur dans ce test).
 * Les sources d'essai sont créées par le provisionnement éditeur et retirées à la fin.
 */
import { randomBytes } from 'node:crypto';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { chargerEnvLocal } from '@comtaple/db/env';
import { domaineOfficiel, enregistrerSurveillance } from '@comtaple/db/provisionnement';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lireSourceOfficielle, type ReponseHttp, verifierSources } from './veille.js';

chargerEnvLocal();
const SEL = randomBytes(4).toString('hex');
const URL_A = `https://www.legifrance.gouv.fr/essai/${SEL}/a`;
const URL_B = `https://bofip.impots.gouv.fr/essai/${SEL}/b`;
const page = (corps: string) => `<html><head><script>x()</script></head><body><h1>Texte officiel</h1><p>${corps}</p>${'<p>Disposition inchangée du texte.</p>'.repeat(20)}</body></html>`;
let editeur: pg.Client;
const bd = creerAccesBd(urlBd('worker'));
let pages: Record<string, ReponseHttp | Error> = {};
const lire = async (url: string) => {
  const r = pages[url];
  if (!r) return { statut: 404, texte: '', urlFinale: url }; // les sources réelles de la base ne sont pas interrogées ici
  if (r instanceof Error) throw r;
  return r;
};
const etat = async (url: string) => (await editeur.query('select dernier_statut, dernier_succes_le, dernier_detail, empreinte_contenu from surveillances_sources where url = $1', [url])).rows[0];
const evolutions = async (url: string) => (await editeur.query('select * from evolutions_reglementaires where url = $1 order by detectee_le', [url])).rows;

beforeAll(async () => {
  editeur = new pg.Client({ connectionString: urlBd('admin') });
  await editeur.connect();
  // Les sources réelles sont mises de côté pendant le test pour ne pas modifier leur suivi.
  await editeur.query(`update surveillances_sources set actif = false where url not like '%/essai/%'`);
  await enregistrerSurveillance(editeur, { emetteur: 'Légifrance', libelle: `Essai A ${SEL}`, url: URL_A });
  await enregistrerSurveillance(editeur, { emetteur: 'BOFiP', libelle: `Essai B ${SEL}`, url: URL_B });
});
afterAll(async () => {
  await editeur.query(`delete from evolutions_reglementaires where url like $1`, [`%/essai/${SEL}/%`]);
  await editeur.query(`delete from surveillances_sources where url like $1`, [`%/essai/${SEL}/%`]);
  await editeur.query(`update surveillances_sources set actif = true`);
  await editeur.end();
  await bd.fermer();
});

describe('surveillance des sources officielles', () => {
  it('n’accepte que des pages https de domaines officiels', async () => {
    expect(domaineOfficiel('https://www.legifrance.gouv.fr/codes/x')).toBe(true);
    expect(domaineOfficiel('http://www.legifrance.gouv.fr/codes/x')).toBe(false);
    expect(domaineOfficiel('https://legifrance.gouv.fr.exemple.test/x')).toBe(false);
    expect(domaineOfficiel('https://exemple.test/legifrance.gouv.fr')).toBe(false);
    await expect(enregistrerSurveillance(editeur, { emetteur: 'x', libelle: 'x', url: 'https://exemple.test/page' })).rejects.toThrow(/domaine officiel/);
    await expect(lireSourceOfficielle('https://exemple.test/page')).rejects.toThrow(/domaines officiels/);
    await expect(lireSourceOfficielle('http://127.0.0.1:5432/')).rejects.toThrow(/domaines officiels/);
  });

  it('première lecture : état de référence, aucune évolution créée', async () => {
    pages = { [URL_A]: { statut: 200, texte: page('Le taux est de 20 %.'), urlFinale: URL_A }, [URL_B]: { statut: 200, texte: page('Seuil de 500 euros.'), urlFinale: URL_B } };
    const b = await verifierSources(bd, lire);
    expect(b).toMatchObject({ verifiees: 2, inchangees: 2, changements: 0, indisponibles: 0 });
    expect((await etat(URL_A)).dernier_statut).toBe('inchangee');
    expect(await evolutions(URL_A)).toHaveLength(0);
  });

  it('un changement de mise en forme seul n’est pas un changement ; un changement de texte crée une évolution à qualifier, sans résumé', async () => {
    pages[URL_A] = { statut: 200, texte: page('Le   taux est de 20&nbsp;%.').replace('<h1>', '<h1 class="titre">'), urlFinale: URL_A };
    expect((await verifierSources(bd, lire)).changements).toBe(0);
    pages[URL_A] = { statut: 200, texte: page('Le taux est de 10 %.'), urlFinale: URL_A };
    expect(await verifierSources(bd, lire)).toMatchObject({ changements: 1, inchangees: 1 });
    const [e] = await evolutions(URL_A);
    expect(e).toMatchObject({ etat_verification: 'detectee_a_qualifier', resume: null, date_effet: null, emetteur: 'Légifrance' });
    expect(e.criteres).toEqual({});
    expect((await etat(URL_A)).dernier_statut).toBe('changement_detecte');
    // Le même contenu relu ne crée pas une seconde évolution.
    expect((await verifierSources(bd, lire)).changements).toBe(0);
    expect(await evolutions(URL_A)).toHaveLength(1);
  });

  it('source indisponible : signalée, dernière vérification réussie conservée, aucune fausse évolution', async () => {
    const succesAvant = (await etat(URL_B)).dernier_succes_le;
    for (const panne of [new Error('délai dépassé'), { statut: 403, texte: 'Accès refusé', urlFinale: URL_B }, { statut: 200, texte: '<html><body>Vérification en cours…</body></html>', urlFinale: URL_B }]) {
      pages[URL_B] = panne as ReponseHttp | Error;
      expect((await verifierSources(bd, lire)).indisponibles).toBe(1);
      const e = await etat(URL_B);
      expect(e.dernier_statut).toBe('indisponible');
      expect(e.dernier_detail).toBeTruthy();
      expect(e.dernier_succes_le).toEqual(succesAvant);
    }
    expect(await evolutions(URL_B)).toHaveLength(0);
    // Au retour de la source, la comparaison reprend sur la dernière empreinte connue.
    pages[URL_B] = { statut: 200, texte: page('Seuil de 500 euros.'), urlFinale: URL_B };
    await verifierSources(bd, lire);
    expect((await etat(URL_B)).dernier_statut).toBe('inchangee');
  });

  it('le rôle du worker ne peut ni qualifier une évolution ni modifier une règle de production', async () => {
    await expect(bd.pool.query(`update evolutions_reglementaires set etat_verification = 'verifiee'`)).rejects.toThrow(/permission|droit/i);
    await expect(bd.pool.query(`delete from surveillances_sources`)).rejects.toThrow(/permission|droit/i);
    await expect(bd.pool.query(`update sources_reglementaires set version = 'x'`)).rejects.toThrow(/permission|droit/i);
  });
});
