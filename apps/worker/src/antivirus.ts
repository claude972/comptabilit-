import { connect } from 'node:net';

export type VerdictAntivirus = { verdict: 'sain' } | { verdict: 'infecte'; signature: string } | { verdict: 'indisponible'; motif: string };

/** Analyse un contenu par clamd (protocole INSTREAM). Le contenu ne quitte pas le périmètre local. */
export function analyserAntivirus(contenu: Buffer, hote: string, port: number, delaiMs = 60_000): Promise<VerdictAntivirus> {
  return new Promise((resoudre) => {
    const socket = connect({ host: hote, port });
    let reponse = '';
    let termine = false;
    const finir = (v: VerdictAntivirus) => {
      if (termine) return;
      termine = true;
      socket.destroy();
      resoudre(v);
    };
    socket.setTimeout(delaiMs, () => finir({ verdict: 'indisponible', motif: 'délai dépassé' }));
    socket.on('error', (e) => finir({ verdict: 'indisponible', motif: e.message }));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const TAILLE = 64 * 1024;
      for (let i = 0; i < contenu.length; i += TAILLE) {
        const morceau = contenu.subarray(i, i + TAILLE);
        const entete = Buffer.alloc(4);
        entete.writeUInt32BE(morceau.length);
        socket.write(entete);
        socket.write(morceau);
      }
      socket.write(Buffer.alloc(4)); // morceau de taille nulle = fin
    });
    socket.on('data', (d) => (reponse += d.toString('utf8')));
    socket.on('end', () => {
      const r = reponse.replace(/\0/g, '').trim();
      if (/\bOK$/.test(r)) return finir({ verdict: 'sain' });
      const m = /stream: (.+) FOUND$/.exec(r);
      if (m) return finir({ verdict: 'infecte', signature: m[1]! });
      finir({ verdict: 'indisponible', motif: r.slice(0, 200) || 'réponse vide' });
    });
  });
}
