/**
 * Package Center tools. Reads: list, check_updates, info. Writes: install,
 * uninstall, update. Writes refuse to touch DSM itself or kernel-flagged
 * packages.
 *
 * SYNO.Core.Package           — list installed packages
 * SYNO.Core.Package.Server    — query available + check for updates
 * SYNO.Core.Package.Installation — install (POST)
 * SYNO.Core.Package.Uninstallation — uninstall (POST)
 */

import type { Config } from "../config.js";
import type { DsmClient } from "../dsm.js";
import { recordWrite } from "../audit.js";

const HARD_REFUSE_NAMES = new Set(["DSM", "kernel"]);
function refuseIfProtected(name: string) {
  if (HARD_REFUSE_NAMES.has(name)) {
    throw new Error(
      `Refusing to operate on package "${name}" — DSM/kernel updates can brick the host and are out of scope for this MCP. Apply via DSM UI → Control Panel → Update & Restore.`
    );
  }
}

export async function nasPackagesList(dsm: DsmClient) {
  const data = await dsm.call({
    api: "SYNO.Core.Package",
    method: "list",
    version: 2,
    params: { additional: '["description","status","beta"]' },
  });
  return {
    packages: (data?.packages ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      status: p.status,
      additional: {
        description: p.additional?.description,
        beta: p.additional?.beta,
        is_system: !!p.is_system_package,
      },
    })),
  };
}

export async function nasPackagesCheckUpdates(dsm: DsmClient) {
  // `SYNO.Core.Package.Server.list?tab=update` returns the whole catalog of
  // packages installable on this DS — NOT actual pending updates — and the
  // response has no installed_version field, so we can't filter from one
  // endpoint. Pull the installed-package list and intersect.
  const [installed, catalog] = await Promise.all([
    dsm.call<any>({
      api: "SYNO.Core.Package",
      method: "list",
      version: 2,
    }),
    dsm.call<any>({
      api: "SYNO.Core.Package.Server",
      method: "list",
      version: 2,
      params: { tab: "update" },
    }),
  ]);
  const installedVersionById = new Map<string, string>();
  for (const p of installed?.packages ?? []) {
    installedVersionById.set(p.id, p.version);
  }
  const pending: Array<Record<string, unknown>> = [];
  for (const p of catalog?.packages ?? []) {
    if (HARD_REFUSE_NAMES.has(p.id)) continue;
    const installedVersion = installedVersionById.get(p.id);
    if (!installedVersion) continue; // not installed on this NAS
    if (installedVersion === p.version) continue; // already current
    pending.push({
      id: p.id,
      name: p.name,
      installed_version: installedVersion,
      available_version: p.version,
      changelog: p.changelog,
      beta: p.beta,
    });
  }
  return { pending };
}

export async function nasPackageInfo(
  dsm: DsmClient,
  args: { name: string }
) {
  const data = await dsm.call({
    api: "SYNO.Core.Package.Server",
    method: "get",
    version: 2,
    params: { id: args.name },
  });
  return {
    id: data?.id,
    name: data?.name,
    version: data?.version,
    publisher: data?.publisher,
    description: data?.description,
    changelog: data?.changelog,
    dependencies: data?.depend_packages,
    install_dep_packages: data?.install_dep_packages,
    size: data?.size,
    beta: data?.beta,
  };
}

interface InstallArgs {
  name: string;
  version?: string;
}

export async function nasPackageInstall(
  cfg: Config,
  dsm: DsmClient,
  args: InstallArgs
) {
  refuseIfProtected(args.name);
  const before = await listOneState(dsm, args.name);
  let after: any = null;
  let ok = false;
  let error: string | undefined;
  try {
    await dsm.call({
      api: "SYNO.Core.Package.Installation",
      method: "install",
      version: 2,
      post: true,
      params: { name: args.name, version: args.version },
    });
    after = await listOneState(dsm, args.name);
    ok = true;
  } catch (err: any) {
    error = String(err?.message ?? err);
    throw err;
  } finally {
    await recordWrite(cfg, {
      tool: "nas_package_install",
      args: { ...args },
      before,
      after,
      ok,
      error,
    });
  }
  return { before, after, verified: after?.version != null };
}

interface UninstallArgs {
  name: string;
  keep_data?: boolean;
}

export async function nasPackageUninstall(
  cfg: Config,
  dsm: DsmClient,
  args: UninstallArgs
) {
  refuseIfProtected(args.name);
  const keep = args.keep_data ?? true;
  const before = await listOneState(dsm, args.name);
  let after: any = null;
  let ok = false;
  let error: string | undefined;
  try {
    await dsm.call({
      api: "SYNO.Core.Package.Uninstallation",
      method: "uninstall",
      version: 1,
      post: true,
      params: { id: args.name, dsm_apps: keep ? "true" : "false" },
    });
    after = await listOneState(dsm, args.name);
    ok = true;
  } catch (err: any) {
    error = String(err?.message ?? err);
    throw err;
  } finally {
    await recordWrite(cfg, {
      tool: "nas_package_uninstall",
      args: { ...args, keep_data: keep },
      before,
      after,
      ok,
      error,
    });
  }
  return { before, after, removed: after == null };
}

export async function nasPackageUpdate(
  cfg: Config,
  dsm: DsmClient,
  args: { name: string }
) {
  refuseIfProtected(args.name);
  const before = await listOneState(dsm, args.name);
  let after: any = null;
  let ok = false;
  let error: string | undefined;
  try {
    await dsm.call({
      api: "SYNO.Core.Package.Installation",
      method: "install",
      version: 2,
      post: true,
      params: { name: args.name },
    });
    after = await listOneState(dsm, args.name);
    ok = true;
  } catch (err: any) {
    error = String(err?.message ?? err);
    throw err;
  } finally {
    await recordWrite(cfg, {
      tool: "nas_package_update",
      args: { ...args },
      before,
      after,
      ok,
      error,
    });
  }
  return {
    before,
    after,
    verified: !!after && after.version !== before?.version,
  };
}

async function listOneState(dsm: DsmClient, name: string) {
  const all = await nasPackagesList(dsm);
  return (
    all.packages.find((p: any) => p.id === name || p.name === name) ?? null
  );
}
