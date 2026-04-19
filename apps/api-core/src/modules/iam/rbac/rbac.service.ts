import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { newEnforcer, newModelFromString, Enforcer } from 'casbin';
import { RBAC_MODEL, RBAC_POLICY, RBAC_GROUPINGS } from './rbac.model';

/**
 * Thin Casbin wrapper. Loads policy in-memory at boot; policy changes at MVP
 * require a redeploy, which is acceptable for a pilot.
 *
 * Usage:
 *   if (!(await this.rbac.can(user.roles[0], 'courses:publish', 'write'))) throw ...
 */
@Injectable()
export class RbacService implements OnModuleInit {
  private readonly log = new Logger(RbacService.name);
  private enforcer!: Enforcer;

  async onModuleInit(): Promise<void> {
    const model = newModelFromString(RBAC_MODEL);
    this.enforcer = await newEnforcer(model);
    for (const [sub, obj, act] of RBAC_POLICY) {
      await this.enforcer.addPolicy(sub, obj, act);
    }
    for (const [from, to] of RBAC_GROUPINGS) {
      await this.enforcer.addGroupingPolicy(from, to);
    }
    this.log.log(`RBAC loaded: ${RBAC_POLICY.length} policies, ${RBAC_GROUPINGS.length} groupings`);
  }

  async can(role: string, obj: string, act: string): Promise<boolean> {
    return this.enforcer.enforce(role, obj, act);
  }

  async anyCan(roles: string[], obj: string, act: string): Promise<boolean> {
    for (const r of roles) {
      if (await this.can(r, obj, act)) return true;
    }
    return false;
  }
}
