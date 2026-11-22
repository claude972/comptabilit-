/**
 * Protocole d'ENTRÉE À CRÉDIT (D-171) — processus enfant RÉEL (`dist/analyse-enfant.js` : `pnpm run build` d'abord). Le parent n'écrit jamais plus de FENETRE_CREDIT_OCTETS octets de
 * corps non consommés par l'enfant, même quand le traitement des lots est lent, et le résultat est identique à celui du protocole sans crédit. Le mode conteneur applique le même code
 * (essais de l'image réelle : `analyse-conteneur.itest.ts`, `ESSAIS_CONTENEUR=1`).
 */
import { genererFecSynthetique, type LigneFec } from '@comtaple/core';
import { describe, expect, it } from 'vitest';
import { analyserFecIsole, ENTREE_ENFANT, type OptionsAnalyse } from './analyse-isolee.js';
import { FENETRE_CREDIT_OCTETS } from './analyse-types.js';

const EX = { debut: '2025-01-01', fin: '2025-12-31' };
async function* enBlocs64(buf: Buffer): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < buf.length; i += 64 * 1024) yield buf.subarray(i, i + 64 * 1024);
}

describe('entrée à crédit : fenêtre d’écriture bornée par ce que l’enfant a consommé', () => {
  it('FEC d’environ 6 Mo, traitement des lots LENT : jamais plus de la fenêtre en vol, tous les octets écrits et crédités, lignes exactes', async () => {
    const fec = genererFecSynthetique({ exercice: EX, nbEcritures: 12_000, graine: 9911 });
    const buf = Buffer.from(fec.contenu);
    const mesureCredit: NonNullable<OptionsAnalyse['mesureCredit']> = { actif: false, ecrit: 0, credite: 0, maxEnVol: 0 };
    let lignes = 0;
    let maxVuDansLot = 0;
    const issue = await analyserFecIsole(
      enBlocs64(buf),
      {
        exerciceDebut: EX.debut,
        exerciceFin: EX.fin,
        nomFichier: fec.nomFichier,
        surLot: async (l: LigneFec[]) => {
          lignes += l.length;
          maxVuDansLot = Math.max(maxVuDansLot, mesureCredit.ecrit - mesureCredit.credite);
          await new Promise((r) => setTimeout(r, 15)); // consommateur lent : la contre-pression doit remonter jusqu'au parent
        },
      },
      { mesureCredit },
    );
    expect(issue.ok).toBe(true);
    expect(lignes).toBe(fec.nbLignes);
    expect(mesureCredit.actif).toBe(true);
    expect(mesureCredit.ecrit).toBe(buf.length);
    expect(mesureCredit.credite).toBe(buf.length); // tout ce qui a été écrit a été consommé et crédité
    expect(mesureCredit.maxEnVol).toBeLessThanOrEqual(FENETRE_CREDIT_OCTETS);
    expect(maxVuDansLot).toBeLessThanOrEqual(FENETRE_CREDIT_OCTETS);
    console.log(`[mesure] crédit : ${buf.length} octets, maximum en vol ${mesureCredit.maxEnVol} (fenêtre ${FENETRE_CREDIT_OCTETS}), ${lignes} lignes`);
  }, 120_000);

  it('point d’entrée explicite (essais) : protocole inactif côté parent, lignes exactes, aucune ligne de crédit dans le texte d’erreur', async () => {
    const mesureCredit: NonNullable<OptionsAnalyse['mesureCredit']> = { actif: true, ecrit: 0, credite: 0, maxEnVol: 0 };
    const fec = genererFecSynthetique({ exercice: EX, nbEcritures: 300, graine: 9912 });
    let lignes = 0;
    const issue = await analyserFecIsole(enBlocs64(Buffer.from(fec.contenu)), { exerciceDebut: EX.debut, exerciceFin: EX.fin, nomFichier: fec.nomFichier, surLot: async (l: LigneFec[]) => void (lignes += l.length) }, { entree: ENTREE_ENFANT, mesureCredit });
    expect(issue.ok).toBe(true);
    expect(lignes).toBe(fec.nbLignes);
    expect(mesureCredit.actif).toBe(false);
  }, 60_000);
});
