// apps/api/src/shared/min-app-version.ts
import type { NextFunction, Request, Response } from 'express';

type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux';
export type MinVersions = Partial<Record<Platform, string>>;

// Compare "1.10.0" with "1.9.3" numerically, part by part
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// getMin reads config on every call (short cache), so the minimum can be raised without a deploy
export function requireMinAppVersion(getMin: () => MinVersions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const platform = req.header('x-app-platform') as Platform | undefined;
    const version = req.header('x-app-version');
    const min = platform ? getMin()[platform] : undefined;
    if (!min || !version) return next();          // web sends no header: always the latest version
    if (compareVersions(version, min) < 0) {
      return res.status(426).json({
        error: {
          code: 'app_update_required',
          message: 'Phiên bản app đã cũ, vui lòng cập nhật để tiếp tục.',
          details: { minVersion: min },
        },
      });
    }
    return next();
  };
}
