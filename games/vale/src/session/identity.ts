// VALE session — identity (CONTRACT §7 login seam).
//
// There are no accounts in this slice. LocalIdentityProvider holds a LocalIdentity created once on
// first boot ('local-<random>') and persisted inside the Profile; only the display name is
// editable. canSignIn is false.
//
// LOGIN SEAM: a LoginIdentityProvider implements the same IdentityProvider (kind 'account',
// canSignIn true) plus the AccountIdentityProvider extras below; it is paired with a
// RemoteProfileStore (ProfileStore over HTTPS, server-authoritative wallet/ledger/ownership). The
// session and everything above it keep calling current()/rename() and never learn which one runs.
// Migrating a local profile into an account is a server call that imports the local ledger and
// ownership records as 'migration' entries (see profile_store.ts for the record shapes).

import type { Identity, IdentityProvider } from '../contracts/session.ts';

export const NAME_MIN = 2;
export const NAME_MAX = 16;

/** what a signed-in provider adds (not implemented in this build) */
export interface AccountIdentityProvider extends IdentityProvider {
  signIn(): Promise<Identity>;
  signOut(): Promise<void>;
}

/** trim, collapse whitespace, strip control/markup characters, clamp to NAME_MAX; too short → fallback */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return s.length >= NAME_MIN ? s : fallback;
}

export function newLocalIdentity(token: string, displayName: string, createdAt: string): Identity {
  return { id: `local-${token}`, displayName, kind: 'local', createdAt };
}

export class LocalIdentityProvider implements IdentityProvider {
  readonly canSignIn = false;
  private id: Identity;
  private readonly onChange: ((id: Identity) => void) | undefined;

  constructor(initial: Identity, onChange?: (id: Identity) => void) {
    this.id = { ...initial };
    this.onChange = onChange;
  }
  current(): Identity { return { ...this.id }; }
  rename(name: string): Identity {
    const next = sanitizeName(name, this.id.displayName);
    if (next !== this.id.displayName) {
      this.id = { ...this.id, displayName: next };
      this.onChange?.(this.current());
    }
    return this.current();
  }
}
