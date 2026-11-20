/**
 * Lecture d'un relevé bancaire : TOUT ce qui interprète les octets d'un relevé déposé (détection de l'encodage et du
 * format, analyse XML camt.053, OFX, CSV, document d'agrégation). Ce module ne s'exécute que dans le processus enfant
 * d'analyse (`analyse-enfant.ts`) ; le processus du worker ne l'importe jamais (vérifié par test).
 * Aucun accès réseau, base ou fichier. Les libellés bancaires sont des données non fiables : restitués, jamais interprétés.
 */
import { decoderTexteReleve, detecterFormatReleve, lireCamt053, lireCsvBanque, lireOfx, lireReleveAgregation, type ProfilCsvBanque, proposerProfilCsv, type RapportReleve } from '@comtaple/core';
import type { ResultatReleve } from './analyse-types.js';

export function lireReleve(contenu: Uint8Array, demande: { profilCsv: ProfilCsvBanque | null; profilInvalide: boolean }): ResultatReleve {
  const { texte, encodage } = decoderTexteReleve(new Uint8Array(contenu));
  const format = detecterFormatReleve(texte.slice(0, 8192));
  const lu = (rapport: RapportReleve, profil: ProfilCsvBanque | null = null, origineProfil: 'confirme' | 'propose_automatiquement' | null = null, raisons: string[] = []): ResultatReleve => ({ etat: 'lu', encodage, rapport, profil, origineProfil, raisons });
  if (format === 'camt.053') return lu(lireCamt053(texte));
  if (format === 'ofx') return lu(lireOfx(texte));
  if (format === 'agregation') return lu(lireReleveAgregation(texte));
  if (format !== 'csv') return { etat: 'format_inconnu', format };
  // CSV : un profil de colonnes confirmé par un humain l'emporte ; sinon proposition prudente, abstention si ambiguë.
  if (demande.profilInvalide) return { etat: 'profil_invalide', format };
  if (demande.profilCsv) return lu(lireCsvBanque(texte, demande.profilCsv), demande.profilCsv, 'confirme');
  const proposition = proposerProfilCsv(texte);
  if (!proposition.profil) return { etat: 'profil_a_confirmer', format, raisons: proposition.raisons };
  return lu(lireCsvBanque(texte, proposition.profil), proposition.profil, 'propose_automatiquement', proposition.raisons);
}
