import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { connexionRedis, Files, lireConfig, Stockage } from '@comtaple/plateforme';
import { GardeAcces } from './acces.js';
import { AuditController } from './audit.controller.js';
import { ComptabiliteController } from './comptabilite.controller.js';
import { DocumentsController } from './documents.controller.js';
import { BD, CONFIG, STOCKAGE, TACHES } from './jetons.js';
import { ProfilController } from './profil.controller.js';
import { ReferenceController } from './reference.controller.js';
import { TeleversementsController } from './televersements.controller.js';

@Module({
  controllers: [ProfilController, TeleversementsController, DocumentsController, ComptabiliteController, ReferenceController, AuditController],
  providers: [
    { provide: CONFIG, useFactory: () => lireConfig() },
    // Le serveur interactif se connecte avec le rôle comtaple_app : jamais propriétaire, jamais BYPASSRLS.
    { provide: BD, useFactory: () => creerAccesBd(urlBd('app')) },
    {
      provide: STOCKAGE,
      inject: [CONFIG],
      useFactory: async (cfg: ReturnType<typeof lireConfig>) => {
        const st = new Stockage(cfg);
        await st.assurerBucket();
        return st;
      },
    },
    { provide: TACHES, inject: [CONFIG], useFactory: (cfg: ReturnType<typeof lireConfig>) => new Files(connexionRedis(cfg.REDIS_URL)) },
    { provide: APP_GUARD, useClass: GardeAcces },
  ],
})
export class AppModule {}
