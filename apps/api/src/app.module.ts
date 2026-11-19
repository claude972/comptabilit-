import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { creerAccesBd, urlBd } from '@comtaple/db';
import { connecteursMail, connexionRedis, Files, lireConfig, Stockage } from '@comtaple/plateforme';
import { GardeAcces } from './acces.js';
import { AbonnementController } from './abonnement.controller.js';
import { AdministrationController } from './administration.controller.js';
import { AuditController } from './audit.controller.js';
import { BanqueController } from './banque.controller.js';
import { ComptabiliteController } from './comptabilite.controller.js';
import { ConseilsController } from './conseils.controller.js';
import { DocumentsController } from './documents.controller.js';
import { IntegrationsController } from './integrations.controller.js';
import { BD, CONFIG, MAIL, STOCKAGE, TACHES } from './jetons.js';
import { MailController } from './mail.controller.js';
import { MissionsController } from './missions.controller.js';
import { ProfilController } from './profil.controller.js';
import { ReferenceController } from './reference.controller.js';
import { ReglesController } from './regles.controller.js';
import { RestitutionController } from './restitution.controller.js';
import { TeleversementsController } from './televersements.controller.js';

@Module({
  controllers: [ProfilController, TeleversementsController, DocumentsController, ComptabiliteController, ReferenceController, AuditController, IntegrationsController, MailController, BanqueController, AdministrationController, AbonnementController, ReglesController, RestitutionController, MissionsController, ConseilsController],
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
    { provide: TACHES, inject: [CONFIG], useFactory: (cfg: ReturnType<typeof lireConfig>) => new Files(connexionRedis(cfg.REDIS_URL), cfg.FILES_PREFIXE) },
    { provide: MAIL, inject: [CONFIG], useFactory: (cfg: ReturnType<typeof lireConfig>) => connecteursMail(cfg) },
    { provide: APP_GUARD, useClass: GardeAcces },
  ],
})
export class AppModule {}
