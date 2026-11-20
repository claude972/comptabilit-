import { describe, expect, it } from 'vitest';
import { empreinteCleVapid } from './notifications-poussees.js';
import { retirerAbonnementsVapidObsoletes } from './rotation-vapid.js';

/** Faux client PostgreSQL : enregistre les requêtes ; la lecture initiale rend les abonnements fournis. */
function fauxClient(abonnements: Array<{ id: string; cabinet_id: string; service: string; empreinte_cle_vapid: string | null }>) {
  const requetes: string[] = [];
  const supprimes: string[] = [];
  const client = {
    query: async (texte: string, valeurs: unknown[] = []) => {
      requetes.push(texte.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
      if (/^select id::text, cabinet_id::text/i.test(texte.trim())) return { rows: abonnements.map((a) => ({ ...a })), rowCount: abonnements.length };
      if (/^select empreinte_cle_vapid, utilisateur_id/i.test(texte.trim())) {
        const a = abonnements.find((x) => x.id === valeurs[0]);
        return { rows: a ? [{ empreinte_cle_vapid: a.empreinte_cle_vapid, utilisateur_id: 'u1' }] : [], rowCount: a ? 1 : 0 };
      }
      if (/^delete from abonnements_pousses/i.test(texte.trim())) {
        const a = abonnements.find((x) => x.id === valeurs[0]);
        const ok = !!a && a.empreinte_cle_vapid !== null && a.empreinte_cle_vapid !== valeurs[1];
        if (ok) supprimes.push(a!.id);
        return { rows: ok ? [{ id: a!.id }] : [], rowCount: ok ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, requetes, supprimes };
}
const COURANTE = 'BCleCouranteFictive-0000000000000000000000000000000000000000000000000000000000000000000000000000000';
const ANCIENNE = 'BCleAncienneFictive-0000000000000000000000000000000000000000000000000000000000000000000000000000000';
const CAB = '0048a1e7-0000-4000-8000-0000000000c1';
const ligne = (id: string, e: string | null) => ({ id, cabinet_id: CAB, service: 'simulateur', empreinte_cle_vapid: e });

describe('retrait en masse des abonnements après rotation des clés VAPID (garde-fous, sans base)', () => {
  it('refuse sans clé publique courante, avec un cabinet ou une limite invalides : aucune requête n’est émise', async () => {
    const { client, requetes } = fauxClient([ligne('a', empreinteCleVapid(ANCIENNE))]);
    for (const cle of ['', '   ', undefined]) await expect(retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: cle }, { appliquer: true })).rejects.toThrow(/PUSH_VAPID_CLE_PUBLIQUE est vide/);
    await expect(retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: COURANTE }, { cabinetId: 'x' })).rejects.toThrow(/cabinet invalide/);
    for (const limite of [0, -1, 1.5, Number.NaN]) await expect(retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: COURANTE }, { limite })).rejects.toThrow(/Limite invalide/);
    expect(requetes).toEqual([]);
  });

  it('simulation (défaut) : une seule lecture, aucune écriture, aucune transaction ; décomptes exacts', async () => {
    const { client, requetes, supprimes } = fauxClient([ligne('ok', empreinteCleVapid(COURANTE)), ligne('vieux1', empreinteCleVapid(ANCIENNE)), ligne('vieux2', empreinteCleVapid(ANCIENNE)), ligne('inconnu', null)]);
    const r = await retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: COURANTE }, {});
    expect(r).toMatchObject({ simulation: true, abonnements: 4, correspondants: 1, empreinteInconnue: 1, obsoletes: 2, retires: 0, restantsObsoletes: 2, interrompu: false });
    expect(r.concernes.map((c) => c.id)).toEqual(['vieux1', 'vieux2']);
    expect(requetes).toHaveLength(1);
    expect(supprimes).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(COURANTE);
  });

  it('application : retire seulement empreinte connue et différente ; jamais celui qui correspond, ni l’inconnu ; limite respectée', async () => {
    const abonnements = [ligne('ok', empreinteCleVapid(COURANTE)), ligne('vieux1', empreinteCleVapid(ANCIENNE)), ligne('vieux2', empreinteCleVapid(ANCIENNE)), ligne('inconnu', null)];
    const { client, supprimes } = fauxClient(abonnements);
    const r = await retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: COURANTE }, { appliquer: true, limite: 1 });
    expect(r).toMatchObject({ simulation: false, retires: 1, interrompu: true, restantsObsoletes: 1 });
    expect(supprimes).toEqual(['vieux1']);
    const suite = await retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: COURANTE }, { appliquer: true });
    expect(suite.interrompu).toBe(false);
    expect(supprimes).toContain('vieux2'); // (ce faux client ne retire pas la ligne de sa liste : « vieux1 » est revu, la vraie base ne l'a plus)
    expect(supprimes).not.toContain('ok');
    expect(supprimes).not.toContain('inconnu');
  });

  it('abonnement réactivé entre la lecture et le verrou (empreinte devenue courante) : rien n’est supprimé', async () => {
    const abonnements = [ligne('vieux', empreinteCleVapid(ANCIENNE))];
    const { client, supprimes } = fauxClient(abonnements);
    // La lecture initiale voit l'ancienne empreinte ; au verrou, l'appareil s'est réabonné avec la clé courante.
    const lecture = client.query.bind(client);
    let premiere = true;
    client.query = async (t: string, v?: unknown[]) => {
      const r = await lecture(t, v);
      if (/^select id::text, cabinet_id::text/i.test(t.trim()) && premiere) {
        premiere = false;
        abonnements[0]!.empreinte_cle_vapid = empreinteCleVapid(COURANTE);
      }
      return r;
    };
    const r = await retirerAbonnementsVapidObsoletes(client, { PUSH_VAPID_CLE_PUBLIQUE: COURANTE }, { appliquer: true });
    expect(r).toMatchObject({ obsoletes: 1, retires: 0 });
    expect(supprimes).toEqual([]);
  });
});
