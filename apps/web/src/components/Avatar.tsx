import type { UserSummary } from '@lms/shared-types';

/**
 * Renders a user avatar — photo if `avatar_url` is set (OAuth users carry a
 * Google/GitHub picture), otherwise a coloured initials circle generated
 * from `display_name`. The colour is deterministic per user so the same
 * person shows the same avatar everywhere.
 */
export function Avatar({
  user,
  size = 36,
}: {
  user: Pick<UserSummary, 'display_name' | 'avatar_url' | 'id'>;
  size?: number;
}) {
  if (user.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatar_url}
        alt={user.display_name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = initialsOf(user.display_name);
  const hue = hashHue(user.id || user.display_name);
  return (
    <div
      className="grid place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue + 40) % 360},70%,45%))`,
      }}
      aria-label={user.display_name}
    >
      {initials}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
