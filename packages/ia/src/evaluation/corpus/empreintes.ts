/**
 * Empreintes SHA-256 de référence des prompts, par identifiant et version, calculées sur le premier cas de
 * chaque corpus. Un prompt modifié sans changement de version fait échouer le test de non-régression :
 * changer la version du prompt, relancer l'évaluation, puis ajouter ici la nouvelle empreinte.
 */
export const EMPREINTES_PROMPTS: Record<string, string> = {
  'analyser-lettre-mission@1.0.0': '284035a22dd36ed1b3a1049c3b3600a90b5a59c1d3b3ddfdba5ab8e8bd73640e',
  'assistant-documente@1.0.0': '40cb5875211e0323ecff3a4df092d3e6170ac4cf9d713887ebb93bc82c152fc0',
  'classer-piece@1.0.0': '018e9e46f1bf3f6c84f8b9577493ec0222ee5f892d86314c836bd85ad4eec59a',
  'commenter-indicateurs@1.0.0': '8a4fd180c59905e4055d9fb35d4b248991eaea0521cebe2d36b63bb969f3167d',
  'expliquer-constat@1.0.0': '8ab0eb4c6c50ebe83b0273438f5fc46b1d2177932df5c6842d3daeabd26556a6',
  'suggerer-rapprochements@1.0.0': '7959520c23d0035dfa7cb22e9d0aef21f0e27a5ce939ee22e12c7627f103c186',
};
