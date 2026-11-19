import { eq, schema as s } from '@comtaple/db';
import type { ResultatSynchronisation } from '@comtaple/mail';
import { avecVerrouConnexion, type ConnecteursMail, fournisseurDepuisBd, moteurMail, type TacheMail } from '@comtaple/plateforme';
import type { Contexte } from './contexte.js';

/**
 * Tâches de la file « mail » : synchronisation d'une connexion, entretien de sa surveillance, cycle de vie Graph.
 * Une seule opération à la fois par connexion, entre tous les processus (verrou PostgreSQL). Les tâches ne portent
 * que des identifiants ; les messages ne sont lus qu'auprès du fournisseur, par le moteur @comtaple/mail.
 */
export async function traiterTacheMail(c: Contexte, mail: ConnecteursMail, nom: string, t: TacheMail): Promise<void> {
  const ctx = { cabinetId: t.cabinetId };
  const [ligne] = await c.bd.avecContexte(ctx, (tx) =>
    tx.select({ statut: s.connexionsMail.statut, fournisseur: s.connexionsMail.fournisseur }).from(s.connexionsMail).where(eq(s.connexionsMail.id, t.connexionId)),
  );
  // Connexion inconnue, arrêtée (expirée, révoquée, supprimée) ou connecteur non configuré : rien à faire, aucun nouvel essai.
  if (!ligne || ligne.statut !== 'active') return;
  if (!mail.cles || !mail.fournisseurs[fournisseurDepuisBd(ligne.fournisseur)]) {
    console.warn(`[mail] connecteur non configuré : tâche ${nom} ignorée pour la connexion ${t.connexionId}`);
    return;
  }

  const resultat = await avecVerrouConnexion(c.bd, t.connexionId, 120_000, async () => {
    const m = moteurMail(c, mail, ctx);
    let r: ResultatSynchronisation | null = null;
    try {
      if (nom === 'entretenir') await m.moteur.entretenirSurveillance(t.connexionId, { forcer: t.forcer ?? false });
      else if (nom === 'cycle-de-vie' && t.cycleDeVie) {
        r = await m.moteur.traiterCycleDeVie(t.connexionId, { idAbonnement: t.cycleDeVie.idAbonnement, nature: 'cycle_de_vie', evenement: t.cycleDeVie.evenement });
      } else r = await m.moteur.synchroniser(t.connexionId, { declencheur: t.declencheur ?? 'manuel' });
      if (r) {
        const issue = r.issue;
        await c.bd.avecContexte(ctx, (tx) => tx.update(s.connexionsMail).set({ derniereIssue: issue }).where(eq(s.connexionsMail.id, t.connexionId)));
      }
    } finally {
      await m.auditer();
    }
    return r;
  });
  // Erreur passagère du fournisseur (quota, 5xx) : l'état est intact ; BullMQ réessaie avec attente, en nombre borné.
  if (resultat?.issue === 'interrompue') throw new Error('synchronisation interrompue par une erreur passagère du fournisseur');
}

/** Tâches planifiées : met en file une tâche par connexion active (fonction SQL étroite : identifiants seuls). */
export async function planifierMail(c: Contexte, nom: string): Promise<void> {
  const { rows } = await c.bd.pool.query<{ cabinet_id: string; connexion_id: string }>('select * from worker_connexions_mail_actives()');
  for (const r of rows) {
    const tache = { cabinetId: r.cabinet_id, connexionId: r.connexion_id };
    if (nom === 'planifier-surveillances') await c.taches.entretenirMail(tache);
    else await c.taches.synchroniserMail({ ...tache, declencheur: 'periodique' });
  }
}
