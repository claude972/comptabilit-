/**
 * MODE SANS IA — repli déterministe de l'assistant, clairement étiqueté.
 * Exécute la recherche par défaut et les fonctions métier déclenchées par des mots-clés simples de la question,
 * avec les MÊMES contrôles (liste blanche, périmètre, habilitations, audit), puis renvoie les éléments trouvés
 * avec leurs références, dans la même structure de réponse. Aucune rédaction, aucune interprétation.
 */
import type { JournalAuditIa } from '../audit.js';
import { horlogeSysteme, type Horloge } from '../ports.js';
import { MENTION_CONFIANCE } from '../taches/commun.js';
import { normaliserMotsCles } from './fonctions-types.js';
import { executerFonctionMetier, indexerFonctions, type Session } from './fonctions.js';
import { schemaPerimetreImpose, type ElementSource, type FonctionMetier, type Habilitations, type PerimetreImpose, type ReponseAssistant, type Segment } from './types.js';

export const ETIQUETTE_SANS_IA = 'Sans IA : résultats de recherche et calculs du moteur, sans rédaction';
const SEGMENTS_MAX = 40;

export interface DependancesSansIa {
  fonctions: readonly FonctionMetier[];
  habilitations: Habilitations;
  journal: JournalAuditIa;
  horloge?: Horloge;
}

/** Restitution d'un élément : son libellé et ses valeurs identifiées, tels que fournis. Le contenu brut n'est pas repris. */
function restituer(e: ElementSource): string {
  const valeurs = Object.entries(e.valeurs ?? {}).map(([k, v]) => `${k} : ${v}`);
  return valeurs.length > 0 ? `${e.libelle} — ${valeurs.join(' ; ')}` : e.libelle;
}

export async function repondreSansIa(
  dependances: DependancesSansIa,
  demande: { question: string; perimetre: PerimetreImpose },
  cause: { code: string } | null = null,
): Promise<ReponseAssistant> {
  const perimetre = schemaPerimetreImpose.parse(demande.perimetre);
  const session: Session = {
    tache: 'assistant',
    mode: 'sans_ia',
    perimetre,
    fonctions: indexerFonctions(dependances.fonctions),
    habilitations: dependances.habilitations,
    journal: dependances.journal,
    horloge: dependances.horloge ?? horlogeSysteme,
    registre: new Map(),
    refus: [],
    donneesManquantes: [],
    etape: 0,
  };
  const mots = new Set(normaliserMotsCles(demande.question).match(/[a-z0-9]+/g) ?? []);
  const question = normaliserMotsCles(demande.question);
  const segments: Segment[] = [];
  for (const f of session.fonctions.values()) {
    if (!f.sansIa) continue;
    const declenchee = f.sansIa.toujours === true || f.sansIa.motsCles.some((m) => (m.includes(' ') ? question.includes(normaliserMotsCles(m)) : mots.has(normaliserMotsCles(m))));
    if (!declenchee) continue;
    const args = f.sansIa.arguments(demande.question);
    if (args === null || typeof args !== 'object') continue;
    for (const dossierId of f.porteeDossier ? perimetre.dossierIds : [null]) {
      const issue = await executerFonctionMetier(session, f.nom, { ...(args as Record<string, unknown>), ...(dossierId !== null ? { dossierId } : {}) });
      if (issue.issue !== 'executee') continue;
      for (const e of issue.elements) {
        if (segments.length >= SEGMENTS_MAX || segments.some((s) => s.citations[0]?.id === e.id)) continue;
        segments.push({
          type: e.nature === 'resultat_moteur' ? 'calcul' : 'fait',
          texte: restituer(e),
          citations: [{ id: e.id, nature: e.nature, libelle: e.libelle, reference: e.reference ?? null }],
          reglementaire: e.nature === 'source_officielle',
        });
      }
    }
  }
  return {
    statut: segments.length > 0 ? 'repondu' : 'abstention',
    motifAbstention: segments.length > 0 ? null : 'Aucun élément trouvé par la recherche et les fonctions du moteur pour cette question.',
    mode: 'sans_ia',
    etiquette: ETIQUETTE_SANS_IA,
    segments,
    perimetre: { cabinetId: perimetre.cabinetId, dossierIds: [...perimetre.dossierIds], periode: { ...perimetre.periode } },
    donneesManquantes: [...session.donneesManquantes],
    pointsEcartes: [],
    abstentionsPartielles: [],
    refus: [...session.refus],
    sources: [...session.registre.values()].map((e) => ({ id: e.id, nature: e.nature, libelle: e.libelle, reference: e.reference ?? null })),
    etapes: 0,
    confiance: { statut: 'non_evaluee', mention: MENTION_CONFIANCE },
    iaIndisponible: cause,
    prompt: null,
  };
}
