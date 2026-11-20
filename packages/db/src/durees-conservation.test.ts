import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORMAT_DUREES,
  PARAMETRES_PROPOSES,
  type ParametresDurees,
  STATUT_PROPOSITION,
  chargerParametres,
  delaiEffectifSuppression,
  echeanceDe,
  empreinteParametres,
  exigerReferenceValidation,
  validerParametres,
} from './durees-conservation.js';
import { POLITIQUE_FIN_DE_CONTRAT } from './provisionnement.js';

const politique = POLITIQUE_FIN_DE_CONTRAT.categories;
const copie = (): ParametresDurees => JSON.parse(JSON.stringify(PARAMETRES_PROPOSES)) as ParametresDurees;

describe('jeu de paramètres PROPOSÉ : jamais présenté comme validé', () => {
  it('est marqué « PROPOSITION NON VALIDÉE » dans son statut ET dans sa version, sans validation', () => {
    expect(PARAMETRES_PROPOSES.statut).toBe(STATUT_PROPOSITION);
    expect(PARAMETRES_PROPOSES.version).toMatch(/PROPOSITION/);
    expect(PARAMETRES_PROPOSES.validation).toBeNull();
    expect(PARAMETRES_PROPOSES.format).toBe(FORMAT_DUREES);
  });

  it('couvre exactement les catégories de la politique et se valide', () => {
    expect(Object.keys(PARAMETRES_PROPOSES.categories).sort()).toEqual(politique.map((c) => c.code).sort());
    expect(validerParametres(PARAMETRES_PROPOSES, politique)).toEqual([]);
  });

  it('chargé sans fichier : source « defaut », non validé ; l’empreinte est stable', () => {
    const c = chargerParametres(politique);
    expect(c).toMatchObject({ source: 'defaut', nonValide: true, chemin: null });
    expect(c.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(chargerParametres(politique).empreinte).toBe(c.empreinte);
    const autre = copie();
    autre.delaiGraceJours = 91;
    expect(empreinteParametres(autre)).not.toBe(c.empreinte);
  });
});

describe('validation d’un jeu fourni par l’éditeur', () => {
  it('refuse : format, catégories manquantes ou inconnues, durées mal formées, devenirs incompatibles', () => {
    const p = copie();
    (p as { format: string }).format = 'autre';
    delete (p.categories as Record<string, unknown>).banque;
    (p.categories as Record<string, unknown>).inventee = { duree: { jours: 1 }, pointDeDepart: 'evenement', apresEcheance: 'supprimer' };
    p.categories.restitutions_cabinet!.duree = { jours: -1 };
    p.categories.politiques_conservation!.duree = { jusqu_au: '2030-02-31' };
    p.categories.fin_de_contrat!.duree = { jours: 5, jusqu_au: '2030-01-01' } as never;
    p.categories.dossiers!.pointDeDepart = 'evenement'; // catégorie supprimée à l'exécution
    p.categories.pieces_fichiers!.duree = { jusqu_au: '2030-01-01' };
    p.categories.abonnement_facturation!.duree = { jours: 0 }; // conservée : durée non nulle exigée
    p.categories.notifications!.apresEcheance = 'sceller';
    p.delaiGraceJours = 10;
    p.sauvegardes.retentionJours = 2;
    p.sauvegardes.jeuxMinimumConserves = 0;
    p.comptes.delaiDesactivationJours = -1;
    const e = validerParametres(p, politique).join(' | ');
    for (const motif of [/format attendu/, /catégorie « banque » sans règle/, /« inventee » inconnue/, /restitutions_cabinet : jours/, /politiques_conservation : jusqu_au/, /fin_de_contrat : duree = \{ jours \} OU \{ jusqu_au \}/, /dossiers : catégorie supprimée à l’exécution/, /pieces_fichiers : une catégorie supprimée à l’exécution se règle en jours/, /abonnement_facturation : une catégorie conservée ou anonymisée exige une durée de conservation non nulle/, /notifications : « sceller » n’est admis que pour le journal/, /delaiGraceJours/, /retentionJours/, /jeuxMinimumConserves/, /delaiDesactivationJours/]) expect(e).toMatch(motif);
  });

  it('un statut autre que « PROPOSITION NON VALIDÉE » exige sa validation (référence, date, auteur) ; une proposition n’en porte pas', () => {
    const p = copie();
    p.statut = 'VALIDÉE';
    expect(validerParametres(p, politique).join(' ')).toMatch(/exige validation/);
    p.validation = { reference: 'AVIS-DPO-2026-01', date: '2026-12-01', par: 'DPO' };
    expect(validerParametres(p, politique)).toEqual([]);
    p.validation = { reference: 'x', date: '2026-12-01', par: 'DPO' };
    expect(validerParametres(p, politique).join(' ')).toMatch(/exige validation/);
    const q = copie();
    q.validation = { reference: 'AVIS-DPO-2026-01', date: '2026-12-01', par: 'DPO' };
    expect(validerParametres(q, politique).join(' ')).toMatch(/ne porte pas de validation/);
  });

  it('lit un fichier JSON valide ; refuse un fichier illisible ou invalide, sans rien présumer', () => {
    const d = mkdtempSync(join(tmpdir(), 'comtaple-durees-'));
    try {
      const p = copie();
      p.version = '2026-12-01.1';
      p.delaiGraceJours = 120;
      p.statut = 'VALIDÉE';
      p.validation = { reference: 'AVIS-DPO-2026-01', date: '2026-12-01', par: 'DPO du cabinet X' };
      writeFileSync(join(d, 'ok.json'), JSON.stringify(p));
      const c = chargerParametres(politique, join(d, 'ok.json'));
      expect(c).toMatchObject({ source: 'fichier', nonValide: false });
      expect(c.parametres.delaiGraceJours).toBe(120);
      writeFileSync(join(d, 'casse.json'), '{pas du json');
      expect(() => chargerParametres(politique, join(d, 'casse.json'))).toThrow(/illisible ou JSON invalide/);
      writeFileSync(join(d, 'invalide.json'), JSON.stringify({ ...p, delaiGraceJours: 1 }));
      expect(() => chargerParametres(politique, join(d, 'invalide.json'))).toThrow(/delaiGraceJours/);
      expect(() => chargerParametres(politique, join(d, 'absent.json'))).toThrow(/illisible/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('référence de validation exigée pour toute exécution réelle', () => {
  it('refuse l’absence et les valeurs vides ; accepte une référence nette, rognée', () => {
    expect(() => exigerReferenceValidation(undefined)).toThrow(/ne sont pas déclarées validées/);
    expect(() => exigerReferenceValidation('')).toThrow(/ne sont pas déclarées validées/);
    expect(() => exigerReferenceValidation('   ')).toThrow(/ne sont pas déclarées validées/);
    for (const v of ['oui', 'OK', 'test', 'xxxxxxx', 'n/a', 'todo', 'court']) expect(() => exigerReferenceValidation(v), v).toThrow(/pas une référence de validation exploitable/);
    expect(exigerReferenceValidation('  AVIS-DPO-2026-01 ')).toBe('AVIS-DPO-2026-01');
  });

  it('si le jeu porte sa propre validation, la référence fournie doit être la même', () => {
    const d = mkdtempSync(join(tmpdir(), 'comtaple-durees-'));
    try {
      const p = copie();
      p.version = '2026-12-01.1';
      p.statut = 'VALIDÉE';
      p.validation = { reference: 'AVIS-DPO-2026-01', date: '2026-12-01', par: 'DPO' };
      writeFileSync(join(d, 'v.json'), JSON.stringify(p));
      const c = chargerParametres(politique, join(d, 'v.json'));
      expect(exigerReferenceValidation('AVIS-DPO-2026-01', c)).toBe('AVIS-DPO-2026-01');
      expect(() => exigerReferenceValidation('AUTRE-AVIS-99', c)).toThrow(/diffère de celle inscrite/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('échéances', () => {
  it('en jours à partir d’un point de départ, ou « jusqu’au » une date ; inconnue sans point de départ', () => {
    const r = (duree: ParametresDurees['categories'][string]['duree']) => ({ duree, pointDeDepart: 'fin_de_contrat' as const, apresEcheance: 'supprimer' as const });
    expect(echeanceDe(r({ jours: 30 }), '2026-01-15')).toBe('2026-02-14');
    expect(echeanceDe(r({ jours: 366 }), '2026-01-15')).toBe('2027-01-16');
    expect(echeanceDe(r({ jours: 0 }), '2026-03-31')).toBe('2026-03-31');
    expect(echeanceDe(r({ jusqu_au: '2031-06-30' }), '2020-01-01')).toBe('2031-06-30');
    expect(echeanceDe(r({ jusqu_au: '2031-06-30' }), null)).toBe('2031-06-30');
    expect(echeanceDe(r({ jours: 10 }), null)).toBeNull();
  });

  it('délai effectif de suppression : le plus long du délai de grâce et des durées des catégories supprimées', () => {
    const p = copie();
    expect(delaiEffectifSuppression(p, ['dossiers', 'banque'])).toBe(90);
    p.categories.banque!.duree = { jours: 200 };
    expect(delaiEffectifSuppression(p, ['dossiers', 'banque'])).toBe(200);
    expect(delaiEffectifSuppression(p, ['dossiers', 'banque'], 400)).toBe(400);
    expect(delaiEffectifSuppression(p, ['dossiers'], 45)).toBe(45);
  });
});
