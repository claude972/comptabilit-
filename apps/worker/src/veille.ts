import { createHash } from 'node:crypto';
import { texteComparable } from '@comtaple/core';
import type { AccesBd } from '@comtaple/db';
import { domaineOfficiel } from '@comtaple/db/provisionnement';

export interface ReponseHttp {
  statut: number;
  texte: string;
  urlFinale: string;
}
export type LectureHttp = (url: string) => Promise<ReponseHttp>;

const TAILLE_MAX = 5 * 1024 * 1024;

/** Lecture réelle : https, domaines officiels uniquement, redirections suivies seulement vers un domaine admis, taille bornée. */
export const lireSourceOfficielle: LectureHttp = async (url) => {
  let courante = url;
  for (let saut = 0; saut < 5; saut++) {
    if (!domaineOfficiel(courante)) throw new Error('adresse hors des domaines officiels admis');
    const r = await fetch(courante, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'veille-reglementaire/1.0', accept: 'text/html,application/xhtml+xml' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      courante = new URL(r.headers.get('location')!, courante).toString();
      continue;
    }
    const corps = Buffer.from(await r.arrayBuffer());
    if (corps.length > TAILLE_MAX) throw new Error('page trop volumineuse');
    return { statut: r.status, texte: corps.toString('utf8'), urlFinale: courante };
  }
  throw new Error('trop de redirections');
};

export interface BilanVeille {
  verifiees: number;
  inchangees: number;
  changements: number;
  indisponibles: number;
}

/**
 * Passe de surveillance des sources officielles. Pour chaque source : lecture, empreinte du texte, comparaison avec
 * la précédente. Un changement crée une évolution « détectée, à qualifier » SANS résumé ni interprétation : la
 * lecture et la qualification sont humaines. Une source injoignable est marquée indisponible et sa dernière
 * vérification réussie est conservée. Rien ici ne touche aux règles de production.
 */
export async function verifierSources(bd: AccesBd, lire: LectureHttp = lireSourceOfficielle): Promise<BilanVeille> {
  const bilan: BilanVeille = { verifiees: 0, inchangees: 0, changements: 0, indisponibles: 0 };
  const sources = await bd.pool.query<{ id: string; emetteur: string; libelle: string; url: string; empreinte_contenu: string | null }>(
    'select id, emetteur, libelle, url, empreinte_contenu from surveillances_sources where actif order by libelle',
  );
  for (const s of sources.rows) {
    bilan.verifiees++;
    try {
      const r = await lire(s.url);
      if (r.statut !== 200) throw new Error(`HTTP ${r.statut}`);
      const texte = texteComparable(r.texte);
      // Une page presque vide est plus probablement une page d'erreur ou un écran anti-robot qu'un texte abrogé.
      if (texte.length < 200) throw new Error('contenu trop court pour être la source attendue');
      const empreinte = createHash('sha256').update(texte).digest('hex');
      if (s.empreinte_contenu === null || s.empreinte_contenu === empreinte) {
        await bd.pool.query(
          `update surveillances_sources set dernier_essai_le = now(), dernier_succes_le = now(), dernier_statut = 'inchangee', dernier_detail = $2, empreinte_contenu = $3 where id = $1`,
          [s.id, s.empreinte_contenu === null ? 'première lecture : état de référence enregistré' : null, empreinte],
        );
        bilan.inchangees++;
      } else {
        await bd.pool.query(
          `insert into evolutions_reglementaires (surveillance_id, emetteur, reference, url) values ($1, $2, $3, $4)`,
          [s.id, s.emetteur, `Changement détecté : ${s.libelle}`, s.url],
        );
        await bd.pool.query(
          `update surveillances_sources set dernier_essai_le = now(), dernier_succes_le = now(), dernier_statut = 'changement_detecte', dernier_detail = 'le texte de la page a changé depuis la dernière lecture', empreinte_contenu = $2 where id = $1`,
          [s.id, empreinte],
        );
        bilan.changements++;
      }
    } catch (e) {
      await bd.pool.query(`update surveillances_sources set dernier_essai_le = now(), dernier_statut = 'indisponible', dernier_detail = $2 where id = $1`, [
        s.id,
        (e instanceof Error ? e.message : 'erreur').slice(0, 300),
      ]);
      bilan.indisponibles++;
    }
  }
  return bilan;
}
