import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErreurIaTemporaire } from '../erreurs.js';
import { JournalMemoire, monter } from '../essais/outils.js';
import { CORPUS_ASSISTANT, DONNEES_ASSISTANT_SYNTHETIQUES } from '../evaluation/corpus/index.js';
import { creerFonctionsSurDonnees } from '../evaluation/taches.js';
import { PasserelleIa } from '../passerelle.js';
import type { ReponseSimulee } from '../simulateur/index.js';
import { indexerFonctions } from './fonctions.js';
import { ETIQUETTE_IA, FONCTION_REPONSE, PROMPT_ASSISTANT, repondreQuestion, type DependancesAssistant } from './repondre.js';
import { ETIQUETTE_SANS_IA, repondreSansIa } from './sans-ia.js';
import type { ContexteFonction, ElementSource, FonctionMetier } from './types.js';

const PERIMETRE = { cabinetId: 'CAB-1', utilisateurId: 'U-1', dossierIds: ['D-ALPHA'], periode: { debut: '2025-01-01', fin: '2025-12-31' } };
const finale = (segments: unknown[], plus: Record<string, unknown> = {}): ReponseSimulee => ({ appels: [{ nom: FONCTION_REPONSE, arguments: { statut: 'repondu', motifAbstention: null, segments, donneesManquantes: [], ...plus } }] });
const fait = (texte: string, citations: string[], type = 'fait', reglementaire = false) => ({ type, texte, citations, reglementaire });

function preparer(options: { fonctions?: FonctionMetier[]; refuser?: string[]; opts?: DependancesAssistant['options'] } = {}) {
  const m = monter();
  const contextes: ContexteFonction[] = [];
  const demandesHabilitation: Array<Record<string, unknown>> = [];
  const fonctions = (options.fonctions ?? creerFonctionsSurDonnees(DONNEES_ASSISTANT_SYNTHETIQUES)).map((f) => ({
    ...f,
    executer: async (args: unknown, ctx: ContexteFonction) => {
      contextes.push(ctx);
      return f.executer(args, ctx);
    },
  }));
  const deps: DependancesAssistant = {
    passerelle: m.passerelle,
    journal: m.journal,
    fonctions,
    habilitations: {
      autoriser: async (d) => {
        demandesHabilitation.push(d);
        return !(options.refuser ?? []).includes(d.fonction);
      },
    },
    ...(options.opts ? { options: options.opts } : {}),
  };
  return { ...m, deps, contextes, demandesHabilitation };
}

describe('assistant documenté — de bout en bout contre le SIMULATEUR', () => {
  it('répond en segments typés et cités, avec périmètre, période, sources et confiance non évaluée', async () => {
    const { deps, simulateur, journal, contextes, demandesHabilitation } = preparer();
    simulateur.programmer(...CORPUS_ASSISTANT.cas[0]!.simulation);
    const r = await repondreQuestion(deps, { question: 'La facture de la Minoterie du Nord a-t-elle été réglée ?', perimetre: PERIMETRE });
    expect(r).toMatchObject({
      statut: 'repondu',
      mode: 'ia',
      etiquette: ETIQUETTE_IA,
      perimetre: { cabinetId: 'CAB-1', dossierIds: ['D-ALPHA'], periode: { debut: '2025-01-01', fin: '2025-12-31' } },
      etapes: 3,
      refus: [],
      pointsEcartes: [],
      confiance: { statut: 'non_evaluee' },
      prompt: PROMPT_ASSISTANT,
      iaIndisponible: null,
    });
    expect(r.segments.map((s) => [s.type, s.citations.map((c) => c.id)])).toEqual([['fait', ['PIECE-101']], ['fait', ['ECR-55']], ['interpretation', ['PIECE-101', 'ECR-55']]]);
    expect(r.sources.map((s) => s.id)).toEqual(['PIECE-101', 'PIECE-666', 'ECR-55']);
    // Le contexte vu par les fonctions est celui imposé par l'appelant.
    expect(contextes).toEqual([
      { cabinetId: 'CAB-1', utilisateurId: 'U-1', dossierId: 'D-ALPHA', periode: PERIMETRE.periode },
      { cabinetId: 'CAB-1', utilisateurId: 'U-1', dossierId: 'D-ALPHA', periode: PERIMETRE.periode },
    ]);
    expect(demandesHabilitation.map((d) => [d.fonction, d.habilitation, d.dossierId])).toEqual([['rechercherDocuments', 'pieces.lire', 'D-ALPHA'], ['rechercherEcritures', 'ecritures.lire', 'D-ALPHA']]);
    // Audit : 3 appels au modèle et 2 fonctions exécutées, sans contenu.
    expect(journal.appels.map((t) => [t.tache, t.resultat])).toEqual([['assistant', 'ok'], ['assistant', 'ok'], ['assistant', 'ok']]);
    expect(journal.fonctions.map((t) => [t.fonction, t.issue, t.tailles.elements])).toEqual([['rechercherDocuments', 'executee', 2], ['rechercherEcritures', 'executee', 1]]);
    // Les identifiants et empreintes du journal sont aléatoires (UUID, SHA-256) : ils peuvent contenir « 1248 » par hasard (échec CI du 2026-11-22, D-149).
    // Le contrôle porte donc sur le CONTENU consigné, identifiants et empreintes exclus : aucun nom, montant ni consigne ne doit y figurer.
    const sansIdentifiants = JSON.stringify(journal.evenements, (cle, v) => (cle === 'id' || /^empreinte/.test(cle) ? undefined : v));
    expect(sansIdentifiants).not.toMatch(/Minoterie|1248|IGNORE/);
  });

  it('ne déclare au modèle que la liste blanche, le dossier limité au périmètre, et jamais le cabinet', async () => {
    const { deps, simulateur } = preparer();
    simulateur.programmer(finale([], { statut: 'abstention', motifAbstention: 'Rien trouvé.' }));
    await repondreQuestion(deps, { question: 'Question quelconque ?', perimetre: PERIMETRE });
    const demande = simulateur.demandes[0]!;
    expect(demande.choixOutil).toBe('required');
    expect(demande.outils?.map((o) => o.nom).sort()).toEqual(['calculerIndicateur', 'lireBalance', 'listerConstats', 'rechercherDocuments', 'rechercherEcritures', 'rechercherSourcesReglementaires', 'rendre_reponse']);
    const recherche = demande.outils?.find((o) => o.nom === 'rechercherDocuments')?.parametres as { properties: Record<string, { enum?: string[] }>; additionalProperties: boolean };
    expect(recherche.properties.dossierId?.enum).toEqual(['D-ALPHA']);
    expect(recherche.additionalProperties).toBe(false);
    expect(JSON.stringify(demande.outils)).not.toMatch(/cabinetId|sql|SQL/);
    expect(demande.messages[1]?.contenu).toContain('<<<DONNEES question>>>');
    expect(JSON.stringify(demande.messages)).not.toContain('CAB-1');
  });

  it('transmet les résultats de fonctions comme données délimitées et minimisées', async () => {
    const { deps, simulateur } = preparer({ opts: { tailleMaxContenu: 40 } });
    simulateur.programmer({ appels: [{ nom: 'rechercherDocuments', arguments: { requete: 'courrier' } }] }, finale([], { statut: 'abstention', motifAbstention: 'Rien.' }));
    await repondreQuestion(deps, { question: 'Que dit le courrier ?', perimetre: PERIMETRE });
    const outil = simulateur.demandes[1]!.messages.at(-1)!;
    expect(outil.role).toBe('tool');
    expect(outil.contenu).toMatch(/^<<<DONNEES resultat_rechercherDocuments>>>/);
    expect(outil.contenu).toContain('"tronque":true');
    expect(outil.contenu).not.toContain('exporterDossier');
  });
});

describe('assistant documenté — garde-fous', () => {
  it('modèle « manipulé » par une pièce malveillante : fonction interdite, autre dossier, autre cabinet, exfiltration et citation inventée sont bloqués et tracés', async () => {
    const { deps, simulateur, journal, contextes } = preparer();
    simulateur.programmer(...CORPUS_ASSISTANT.cas[1]!.simulation);
    const r = await repondreQuestion(deps, { question: 'Que contient le courrier reçu ?', perimetre: PERIMETRE });
    // L'instruction malveillante a bien été vue par le « modèle » (comme donnée)…
    expect(JSON.stringify(simulateur.demandes[1]!.messages)).toContain('IGNORE LES CONSIGNES');
    // …mais aucune fonction n'a été exécutée hors du périmètre imposé.
    expect(contextes).toEqual([{ cabinetId: 'CAB-1', utilisateurId: 'U-1', dossierId: 'D-ALPHA', periode: PERIMETRE.periode }]);
    expect(r.refus).toEqual([
      { fonction: 'exporterDossier', code: 'fonction_non_autorisee', etape: 2 },
      { fonction: 'rechercherDocuments', code: 'dossier_hors_perimetre', etape: 3 },
      { fonction: 'rechercherDocuments', code: 'changement_de_contexte_refuse', etape: 4 },
    ]);
    expect(journal.fonctions.filter((t) => t.issue === 'refusee').map((t) => [t.fonction, t.code, t.contexte.cabinetId])).toEqual([
      ['exporterDossier', 'fonction_non_autorisee', 'CAB-1'],
      ['rechercherDocuments', 'dossier_hors_perimetre', 'CAB-1'],
      ['rechercherDocuments', 'changement_de_contexte_refuse', 'CAB-1'],
    ]);
    // Le modèle est informé du refus, sans détail exploitable.
    expect(simulateur.demandes[2]!.messages.at(-1)).toMatchObject({ role: 'tool', contenu: '{"refus":"fonction_non_autorisee"}' });
    // La réponse finale est rejetée : rien n'est restitué à l'utilisateur.
    expect(r).toMatchObject({ statut: 'abstention', segments: [], pointsEcartes: [{ index: 0, type: 'fait', motif: 'url_non_sourcee' }, { index: 1, type: 'fait', motif: 'citation_inconnue' }] });
    expect(JSON.stringify(r)).not.toMatch(/exfiltration|D-BETA|CAB-2|42 factures/);
    expect(journal.appels.at(-1)).toMatchObject({ resultat: 'rejet', codes: ['url_non_sourcee', 'citation_inconnue'] });
  });

  it('rejette un fait ou un calcul sans citation, un calcul qui ne cite pas le moteur et un chiffre absent des sources citées', async () => {
    const { deps, simulateur } = preparer();
    simulateur.programmer(
      { appels: [{ nom: 'rechercherDocuments', arguments: { requete: 'facture' } }, { nom: 'calculerIndicateur', arguments: { indicateurId: 'marge_brute' } }] },
      finale([
        fait('La facture F-2025-014 existe.', []),
        fait('Le total est de 1 248,00 EUR.', [], 'calcul'),
        fait('Le total est de 1 248,00 EUR.', ['PIECE-101'], 'calcul'),
        fait('La facture s’élève à 1 500,00 EUR.', ['PIECE-101']),
        fait('Le taux de marge brute est de 32,50 %.', ['PIECE-101']),
        fait('Le taux de marge brute est de 32,50 %.', ['IND-marge_brute-2025'], 'calcul'),
        fait('Hypothèse : un acompte de 300 EUR aurait été versé.', [], 'hypothese'),
        fait('Hypothèse : la facture de 1 248,00 EUR correspond à une livraison de farine.', [], 'hypothese'),
      ]),
    );
    const r = await repondreQuestion(deps, { question: 'Quel est le montant de la facture ?', perimetre: PERIMETRE });
    expect(r.statut).toBe('repondu');
    expect(r.pointsEcartes.map((p) => [p.index, p.motif])).toEqual([[0, 'citation_absente'], [1, 'citation_absente'], [2, 'calcul_sans_resultat_moteur'], [3, 'chiffre_non_source'], [4, 'chiffre_non_source'], [6, 'chiffre_non_source']]);
    expect(r.segments.map((s) => s.type)).toEqual(['calcul', 'hypothese']);
    expect(r.segments[0]?.citations[0]).toMatchObject({ id: 'IND-marge_brute-2025', nature: 'resultat_moteur' });
  });

  it('exige une source officielle pour une affirmation réglementaire, même non déclarée par le modèle', async () => {
    const { deps, simulateur } = preparer();
    simulateur.programmer(
      { appels: [{ nom: 'rechercherDocuments', arguments: { requete: 'facture' } }, { nom: 'rechercherSourcesReglementaires', arguments: { requete: 'conservation' } }] },
      finale([
        fait('La facture F-2025-014 est une pièce du dossier.', ['PIECE-101']),
        fait('Selon le Code de commerce, cette facture doit être conservée.', ['PIECE-101'], 'interpretation', false),
        fait('Le texte de test T-1 exige la conservation des factures.', ['SRC-TEST-1'], 'fait', false),
      ]),
    );
    const r = await repondreQuestion(deps, { question: 'Faut-il conserver cette facture ?', perimetre: PERIMETRE });
    expect(r.statut).toBe('repondu');
    expect(r.abstentionsPartielles).toEqual([{ index: 1, motif: 'reglementaire_sans_source_officielle' }]);
    expect(r.segments.map((s) => [s.type, s.reglementaire, s.citations[0]?.nature])).toEqual([['fait', false, 'piece'], ['fait', true, 'source_officielle']]);
    expect(r.segments[1]?.citations[0]?.reference).toMatchObject({ titre: 'Texte de test T-1', url: 'https://exemple.invalid/texte-t-1' });
  });

  it('vérifie l’habilitation avant chaque exécution et refuse sans exécuter', async () => {
    const { deps, simulateur, contextes, journal } = preparer({ refuser: ['rechercherEcritures'] });
    simulateur.programmer({ appels: [{ nom: 'rechercherEcritures', arguments: { requete: 'Minoterie' } }] }, finale([], { statut: 'abstention', motifAbstention: 'Accès refusé aux écritures.' }));
    const r = await repondreQuestion(deps, { question: 'Quelles écritures ?', perimetre: PERIMETRE });
    expect(contextes).toEqual([]);
    expect(r).toMatchObject({ statut: 'abstention', motifAbstention: 'Accès refusé aux écritures.', refus: [{ fonction: 'rechercherEcritures', code: 'habilitation_refusee', etape: 1 }] });
    expect(journal.fonctions[0]).toMatchObject({ issue: 'refusee', code: 'habilitation_refusee' });
  });

  it('valide les arguments par schéma, borne la période et exige un dossier quand plusieurs sont autorisés', async () => {
    const { deps, simulateur, contextes } = preparer();
    const deux = { ...PERIMETRE, dossierIds: ['D-ALPHA', 'D-GAMMA'] };
    simulateur.programmer(
      {
        appels: [
          { nom: 'rechercherDocuments', arguments: { requete: 'x', limite: 9999, dossierId: 'D-ALPHA' } },
          { nom: 'rechercherDocuments', arguments: { requete: 'facture', sql: 'SELECT * FROM pieces', dossierId: 'D-ALPHA' } },
          { nom: 'rechercherDocuments', arguments: { requete: 'facture' } },
          { nom: 'rechercherDocuments', arguments: { requete: 'facture', dossierId: 'D-ALPHA', periode: { debut: '2024-01-01', fin: '2025-06-30' } } },
          { nom: 'rechercherDocuments', arguments: { requete: 'facture', dossierId: 'D-GAMMA', periode: { debut: '2025-02-01', fin: '2025-03-31' } } },
        ],
      },
      finale([], { statut: 'abstention', motifAbstention: 'Rien.' }),
    );
    const r = await repondreQuestion(deps, { question: 'Factures ?', perimetre: deux });
    expect(r.refus.map((x) => x.code)).toEqual(['arguments_invalides', 'arguments_invalides', 'dossier_a_preciser', 'periode_hors_perimetre']);
    expect(contextes).toEqual([{ cabinetId: 'CAB-1', utilisateurId: 'U-1', dossierId: 'D-GAMMA', periode: { debut: '2025-02-01', fin: '2025-03-31' } }]);
    expect((simulateur.demandes[0]!.outils!.find((o) => o.nom === 'rechercherDocuments')!.parametres as { required: string[] }).required).toContain('dossierId');
  });

  it('écarte du registre un élément d’un dossier hors périmètre renvoyé par erreur par une fonction', async () => {
    const intrus: ElementSource = { id: 'PIECE-AUTRE', nature: 'piece', libelle: 'Pièce d’un autre dossier', contenu: 'secret', dossierId: 'D-BETA' };
    const fuyante: FonctionMetier = {
      nom: 'rechercherDocuments',
      description: 'd',
      habilitation: 'pieces.lire',
      porteeDossier: true,
      schemaArguments: z.strictObject({ requete: z.string() }),
      executer: async () => ({ elements: [intrus, DONNEES_ASSISTANT_SYNTHETIQUES.documents[0]!, { id: '', nature: 'piece' } as unknown as ElementSource] }),
    };
    const { deps, simulateur, journal } = preparer({ fonctions: [fuyante] });
    simulateur.programmer({ appels: [{ nom: 'rechercherDocuments', arguments: { requete: 'tout' } }] }, finale([fait('Une pièce d’un autre dossier existe.', ['PIECE-AUTRE'])]));
    const r = await repondreQuestion(deps, { question: 'Quelles pièces ?', perimetre: PERIMETRE });
    expect(JSON.stringify(simulateur.demandes[1]!.messages)).not.toContain('PIECE-AUTRE');
    expect(r.sources.map((s) => s.id)).toEqual(['PIECE-101']);
    expect(r.pointsEcartes).toEqual([{ index: 0, type: 'fait', motif: 'citation_inconnue' }]);
    expect(journal.fonctions[0]?.tailles).toMatchObject({ elements: 1, elementsEcartes: 2 });
  });

  it('borne le nombre d’étapes et le nombre d’appels par étape', async () => {
    const { deps, simulateur, journal } = preparer({ opts: { etapesMax: 3, appelsMaxParEtape: 2 } });
    simulateur.programmerParDefaut({ appels: [1, 2, 3].map(() => ({ nom: 'listerConstats', arguments: {} })) });
    const r = await repondreQuestion(deps, { question: 'Boucle sans fin ?', perimetre: PERIMETRE });
    expect(r).toMatchObject({ statut: 'abstention', etapes: 3 });
    expect(r.motifAbstention).toContain('Nombre maximal d’étapes atteint (3)');
    expect(simulateur.demandes).toHaveLength(3);
    expect(journal.fonctions).toHaveLength(6);
    expect(r.refus.filter((x) => x.code === 'trop_d_appels')).toHaveLength(3);
  });

  it('rejette une sortie qui n’est ni un appel ni la réponse structurée, et une réponse mêlée à d’autres appels', async () => {
    const a = preparer();
    a.simulateur.programmer({ texte: 'Voici ma réponse en texte libre, sans structure.' });
    expect(await repondreQuestion(a.deps, { question: 'Question ?', perimetre: PERIMETRE })).toMatchObject({ statut: 'abstention', segments: [] });
    expect(a.journal.appels[0]).toMatchObject({ resultat: 'rejet', codes: ['ni_appel_ni_reponse'] });
    const b = preparer();
    b.simulateur.programmer(
      { appels: [{ nom: 'rechercherDocuments', arguments: { requete: 'facture' } }, { nom: FONCTION_REPONSE, arguments: { statut: 'repondu', motifAbstention: null, segments: [], donneesManquantes: [] } }] },
      finale([fait('La facture F-2025-014 est une pièce du dossier.', ['PIECE-101'])]),
    );
    const r = await repondreQuestion(b.deps, { question: 'Question ?', perimetre: PERIMETRE });
    expect(r).toMatchObject({ statut: 'repondu', refus: [{ fonction: FONCTION_REPONSE, code: 'reponse_prematuree', etape: 1 }] });
  });

  it('refuse des déclarations de fonctions non strictes ou portant une clé réservée', () => {
    const base = { description: 'd', habilitation: 'h', porteeDossier: true, executer: async () => ({ elements: [] }) };
    expect(() => indexerFonctions([{ ...base, nom: 'f', schemaArguments: z.string() }])).toThrow(/strictObject/);
    expect(() => indexerFonctions([{ ...base, nom: 'f', schemaArguments: z.strictObject({}) }, { ...base, nom: 'f', schemaArguments: z.strictObject({}) }])).toThrow(/deux fois/);
    expect(() => indexerFonctions([{ ...base, nom: 'f', schemaArguments: z.strictObject({ cabinetId: z.string() }) }])).toThrow(/réservée/);
    expect(() => indexerFonctions([{ ...base, nom: 'exécuter sql', schemaArguments: z.strictObject({}) }])).toThrow(/nom invalide/);
  });

  it('refuse toute clé non déclarée même si le schéma de la fonction n’est pas strict', async () => {
    const laxiste: FonctionMetier = { nom: 'chercher', description: 'd', habilitation: 'h', porteeDossier: true, schemaArguments: z.object({ requete: z.string() }), executer: async () => ({ elements: [] }) };
    const { deps, simulateur, contextes } = preparer({ fonctions: [laxiste] });
    simulateur.programmer({ appels: [{ nom: 'chercher', arguments: { requete: 'x', code: 'process.exit()' } }, { nom: 'chercher', arguments: 'DROP TABLE pieces' }] }, finale([], { statut: 'abstention', motifAbstention: 'Rien.' }));
    const r = await repondreQuestion(deps, { question: 'Question ?', perimetre: PERIMETRE });
    expect(r.refus.map((x) => x.code)).toEqual(['arguments_invalides', 'arguments_invalides']);
    expect(contextes).toEqual([]);
  });

  it('pseudonymise les contenus renvoyés par les fonctions et restaure les valeurs dans la réponse', async () => {
    const donnees = { ...DONNEES_ASSISTANT_SYNTHETIQUES, documents: [{ id: 'PIECE-7', nature: 'piece' as const, libelle: 'RIB fournisseur', contenu: 'IBAN FR76 3000 6000 0112 3456 7890 189, contact compta@minoterie.exemple', dossierId: 'D-ALPHA' }] };
    const { deps, simulateur } = preparer({ fonctions: creerFonctionsSurDonnees(donnees) });
    simulateur.programmer({ appels: [{ nom: 'rechercherDocuments', arguments: { requete: 'RIB' } }] }, (d) => {
      const vu = d.messages.at(-1)?.contenu ?? '';
      return finale([fait(`Le RIB indique le contact ${/⟦EMAIL_\d+⟧/.exec(vu)?.[0]}.`, ['PIECE-7']), fait('Le RIB indique ⟦IBAN_9⟧.', ['PIECE-7'])]) as { appels: Array<{ nom: string; arguments: unknown }> };
    });
    const r = await repondreQuestion(deps, { question: 'Quel est le contact du fournisseur ?', perimetre: PERIMETRE });
    expect(JSON.stringify(simulateur.demandes)).not.toMatch(/FR76|minoterie\.exemple/);
    expect(r.segments.map((s) => s.texte)).toEqual(['Le RIB indique le contact compta@minoterie.exemple.']);
    expect(r.pointsEcartes).toEqual([{ index: 1, type: 'fait', motif: 'jeton_non_restaure' }]);
  });
});

describe('mode sans IA', () => {
  it('exécute la recherche et les fonctions déclenchées par mots-clés, dans la même structure, étiqueté', async () => {
    const journal = new JournalMemoire();
    const deps = { journal, fonctions: creerFonctionsSurDonnees(DONNEES_ASSISTANT_SYNTHETIQUES), habilitations: { autoriser: async () => true } };
    const r = await repondreSansIa(deps, { question: 'Quel est le taux de marge et le délai de conservation des factures ?', perimetre: PERIMETRE });
    expect(r).toMatchObject({ statut: 'repondu', mode: 'sans_ia', etiquette: 'Sans IA : résultats de recherche et calculs du moteur, sans rédaction', etapes: 0, prompt: null, iaIndisponible: null });
    expect(r.etiquette).toBe(ETIQUETTE_SANS_IA);
    expect(journal.fonctions.map((t) => [t.fonction, t.mode, t.issue])).toEqual([
      ['rechercherDocuments', 'sans_ia', 'executee'],
      ['rechercherEcritures', 'sans_ia', 'executee'],
      ['rechercherSourcesReglementaires', 'sans_ia', 'executee'],
      ['calculerIndicateur', 'sans_ia', 'executee'],
    ]);
    expect(r.segments.map((s) => [s.type, s.citations[0]?.id])).toEqual([['fait', 'PIECE-101'], ['fait', 'PIECE-666'], ['fait', 'ECR-55'], ['fait', 'SRC-TEST-1'], ['calcul', 'IND-marge_brute-2025']]);
    expect(r.segments[4]?.texte).toBe('Taux de marge brute — valeur : 32.50 ; unite : pourcentage ; debut : 2025-01-01 ; fin : 2025-12-31');
    // Aucune rédaction : le contenu brut (non fiable) d'une pièce n'est pas repris.
    expect(JSON.stringify(r.segments)).not.toContain('IGNORE');
    expect(journal.appels).toEqual([]);
  });

  it('applique les mêmes habilitations et s’abstient s’il ne trouve rien', async () => {
    const deps = { journal: new JournalMemoire(), fonctions: creerFonctionsSurDonnees({ ...DONNEES_ASSISTANT_SYNTHETIQUES, documents: [] }), habilitations: { autoriser: async (d: { fonction: string }) => d.fonction === 'rechercherDocuments' } };
    const r = await repondreSansIa(deps, { question: 'Quelles écritures sur le compte 401 ?', perimetre: PERIMETRE });
    expect(r).toMatchObject({ statut: 'abstention', segments: [], refus: [{ fonction: 'rechercherEcritures', code: 'habilitation_refusee' }] });
    expect(r.motifAbstention).toContain('Aucun élément trouvé');
  });

  it('prend le relais quand l’IA est absente ou tombe en panne, en le disant', async () => {
    const journal = new JournalMemoire();
    const base = { journal, fonctions: creerFonctionsSurDonnees(DONNEES_ASSISTANT_SYNTHETIQUES), habilitations: { autoriser: async () => true } };
    const absent = await repondreQuestion({ ...base, passerelle: new PasserelleIa({ fournisseur: null, journal }) }, { question: 'Facture de la Minoterie ?', perimetre: PERIMETRE });
    expect(absent).toMatchObject({ statut: 'repondu', mode: 'sans_ia', etiquette: ETIQUETTE_SANS_IA, iaIndisponible: { code: 'non_connecte' } });
    const m = monter();
    m.simulateur.programmer({ appels: [{ nom: 'rechercherDocuments', arguments: { requete: 'facture' } }] }, { erreur: new ErreurIaTemporaire(503, null, 3) });
    const panne = await repondreQuestion({ ...base, journal: m.journal, passerelle: m.passerelle }, { question: 'Facture de la Minoterie ?', perimetre: PERIMETRE });
    expect(panne).toMatchObject({ mode: 'sans_ia', iaIndisponible: { code: 'temporaire' }, statut: 'repondu' });
  });
});
