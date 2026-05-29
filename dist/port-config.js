/**
 * @fileoverview Config-driven bind-port resolution for knowledge dashboard helper servers.
 *
 * Flow: CLI args -> active env file -> process env -> configured default, with non-canonical realm
 * safety checks driven entirely by caller-provided config.
 *
 * @testing Node test runner: npm run knowledge-dashboard-kit:test
 *
 * @see packages/knowledge-dashboard-kit/src/port-config.unit.test.ts - Node tests covering CLI precedence, env-file and process-env resolution, and non-canonical realm collision guards for the helpers exported here.
 * @see scripts/knowledge-base-dashboard/server.ts - Local knowledge dashboard HTTP server that calls `knowledgeDashboardKitResolvePort` from this kit to pick its bind port.
 * @see packages/knowledge-dashboard-kit/src/types.ts - `KnowledgeDashboardKit_ResolvePortOptions` and resolved-port types consumed by the exported resolution helpers in this module.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import fs from "node:fs";
/** Parses a non-empty decimal port string and enforces the TCP port range. */
export function knowledgeDashboardKitParsePositivePort(options) {
    const normalized = options.rawValue.trim();
    if (!/^\d+$/.test(normalized)) {
        throw new Error(`${options.errorPrefix} ${options.label} must be a positive integer port. Received '${options.rawValue}'.`);
    }
    const parsed = Number.parseInt(normalized, 10);
    if (parsed < 1 || parsed > 65535) {
        throw new Error(`${options.errorPrefix} ${options.label} must be between 1 and 65535. Received '${options.rawValue}'.`);
    }
    return parsed;
}
/** Normalizes a raw `.env` value segment by trimming and removing one wrapping quote pair. */
export function knowledgeDashboardKitStripEnvValue(rawValue) {
    const normalized = rawValue.trim();
    if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
        (normalized.startsWith("'") && normalized.endsWith("'"))) {
        return normalized.slice(1, -1);
    }
    return normalized;
}
/** Scans a local env file for a `KEY=value` assignment when the path exists. */
export function knowledgeDashboardKitReadEnvFileValue(options) {
    if (options.envFilePath === null || !fs.existsSync(options.envFilePath)) {
        return null;
    }
    const content = fs.readFileSync(options.envFilePath, "utf8");
    let resolved = null;
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
            continue;
        }
        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) {
            continue;
        }
        const candidateKey = trimmed.slice(0, separatorIndex).trim();
        if (candidateKey === options.key) {
            resolved = knowledgeDashboardKitStripEnvValue(trimmed.slice(separatorIndex + 1));
        }
    }
    return resolved;
}
/** Returns the active env file path (last path in the stack) or null when empty. */
function knowledgeDashboardKitActiveEnvFilePath(activeEnvFilePaths) {
    return activeEnvFilePaths[activeEnvFilePaths.length - 1] ?? null;
}
/** Loads dashboard port overrides from the active env file. */
function knowledgeDashboardKitActivePortEnvValue(options) {
    const canonicalValue = knowledgeDashboardKitReadEnvFileValue({
        envFilePath: options.envFilePath,
        key: options.canonicalPortEnvName,
    });
    if (canonicalValue !== null) {
        return canonicalValue;
    }
    if (options.legacyPortEnvName === undefined) {
        return null;
    }
    return knowledgeDashboardKitReadEnvFileValue({
        envFilePath: options.envFilePath,
        key: options.legacyPortEnvName,
    });
}
/** Parses supported port argv forms, including `flag value` and `flag=value`. */
function knowledgeDashboardKitParseCliPort(options) {
    for (let index = 0; index < options.argv.length; index += 1) {
        const argument = options.argv[index] ?? "";
        for (const flag of options.config.portFlags) {
            if (argument === flag) {
                const value = options.argv[index + 1];
                if (value === undefined || value.trim().length === 0) {
                    throw new Error(`${options.config.errorPrefix} ${flag} requires a port value.`);
                }
                return {
                    port: knowledgeDashboardKitParsePositivePort({
                        errorPrefix: options.config.errorPrefix,
                        label: flag,
                        rawValue: value,
                    }),
                    source: "cli",
                };
            }
            const assignmentPrefix = `${flag}=`;
            if (argument.startsWith(assignmentPrefix)) {
                return {
                    port: knowledgeDashboardKitParsePositivePort({
                        errorPrefix: options.config.errorPrefix,
                        label: flag,
                        rawValue: argument.slice(assignmentPrefix.length),
                    }),
                    source: "cli",
                };
            }
        }
    }
    return null;
}
/** Applies non-canonical realm collision protection to a resolved port. */
function knowledgeDashboardKitAssertRealmPortSafe(options) {
    if (options.realmSlug !== options.config.canonicalRealmSlug &&
        options.port === options.config.defaultPort) {
        throw new Error(`${options.config.errorPrefix} Refusing to bind non-canonical realm '${options.realmSlug}' ` +
            `to the canonical helper port ${options.config.defaultPort}. Set ` +
            `${options.config.canonicalPortEnvName} in the active realm env file or pass a port flag.`);
    }
}
/** Resolves the dashboard bind port from CLI flags, active env files, process env, or defaults. */
export function knowledgeDashboardKitResolvePort(options) {
    const cliPort = knowledgeDashboardKitParseCliPort(options);
    if (cliPort !== null) {
        return cliPort;
    }
    const activeEnvFilePath = knowledgeDashboardKitActiveEnvFilePath(options.activeEnvFilePaths);
    const activeEnvRealmSlug = knowledgeDashboardKitReadEnvFileValue({
        envFilePath: activeEnvFilePath,
        key: options.config.realmSlugEnvName,
    }) ?? options.config.canonicalRealmSlug;
    const realmSlug = (options.env[options.config.realmSlugEnvName] ?? activeEnvRealmSlug)
        .trim()
        .toLowerCase();
    const activeEnvPort = knowledgeDashboardKitActivePortEnvValue({
        envFilePath: activeEnvFilePath,
        canonicalPortEnvName: options.config.canonicalPortEnvName,
        legacyPortEnvName: options.config.legacyPortEnvName,
    });
    if (activeEnvPort !== null) {
        const port = knowledgeDashboardKitParsePositivePort({
            errorPrefix: options.config.errorPrefix,
            label: options.config.canonicalPortEnvName,
            rawValue: activeEnvPort,
        });
        knowledgeDashboardKitAssertRealmPortSafe({
            config: options.config,
            port,
            realmSlug,
        });
        return { port, source: "active-env" };
    }
    const processEnvPort = options.env[options.config.canonicalPortEnvName] ??
        (options.config.legacyPortEnvName === undefined
            ? undefined
            : options.env[options.config.legacyPortEnvName]);
    if (processEnvPort !== undefined && processEnvPort.trim().length > 0) {
        const port = knowledgeDashboardKitParsePositivePort({
            errorPrefix: options.config.errorPrefix,
            label: options.config.canonicalPortEnvName,
            rawValue: processEnvPort,
        });
        knowledgeDashboardKitAssertRealmPortSafe({
            config: options.config,
            port,
            realmSlug,
        });
        return { port, source: "process-env" };
    }
    if (realmSlug !== options.config.canonicalRealmSlug) {
        throw new Error(`${options.config.errorPrefix} Missing ${options.config.canonicalPortEnvName} for ` +
            `non-canonical realm '${realmSlug}'. Non-canonical workspaces must use realm-specific helper ports.`);
    }
    return { port: options.config.defaultPort, source: "default" };
}
//# sourceMappingURL=port-config.js.map