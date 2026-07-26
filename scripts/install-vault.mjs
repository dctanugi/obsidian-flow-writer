#!/usr/bin/env node
/**
 * Copies the built plugin into an Obsidian vault.
 *
 * Vault path comes from, in order: the FLOW_VAULT env var, or a `.vault-path`
 * file in the repo root containing the absolute path to the vault. `.vault-path`
 * is gitignored so nobody's local vault location ends up in the repo.
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ID = "flow-writer";
const FILES = ["main.js", "manifest.json", "styles.css"];

function resolveVault() {
	if (process.env.FLOW_VAULT) return process.env.FLOW_VAULT;
	const configPath = join(root, ".vault-path");
	if (existsSync(configPath)) {
		const value = readFileSync(configPath, "utf8").trim();
		if (value) return value;
	}
	return null;
}

const vault = resolveVault();
if (!vault) {
	console.error(
		"No vault configured.\n" +
			"Write the absolute path to your vault into .vault-path, or set FLOW_VAULT."
	);
	process.exit(1);
}

if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);
	process.exit(1);
}

const dest = join(vault, ".obsidian", "plugins", PLUGIN_ID);
mkdirSync(dest, { recursive: true });

for (const file of FILES) {
	const src = join(root, file);
	if (!existsSync(src)) {
		console.error(`Missing build output: ${file}. Run \`npm run build\` first.`);
		process.exit(1);
	}
	copyFileSync(src, join(dest, file));
}

console.log(`Installed ${PLUGIN_ID} to ${dest}`);
console.log("Reload Obsidian (or toggle the plugin off/on) to pick up the change.");
