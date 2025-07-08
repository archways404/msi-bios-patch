import fs from 'fs/promises';
import path from 'path';

const CONFIG_PATH = path.resolve('./config.json');
const BIOS_URL =
	'https://www.msi.com/api/v1/product/support/panel?product=X870-GAMING-PLUS-WIFI&type=bios';

/* -------------------------------------------------------------------------- */

async function loadConfig() {
	const raw = await fs.readFile(CONFIG_PATH, 'utf8');
	return JSON.parse(raw);
}

async function saveConfig(cfg) {
	await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

async function fetchBiosList() {
	const res = await fetch(BIOS_URL, {
		headers: {
			/* browser fingerprint -------------------------------------------- */
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
				'(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',

			/* “I really came from msi.com” ------------------------------------ */
			Origin: 'https://www.msi.com',
			Referer: 'https://www.msi.com/Motherboard/X870-GAMING-PLUS-WIFI/support',

			/* typical XHR / fetch headers ------------------------------------- */
			Accept: 'application/json, text/plain, */*',
			'X-Requested-With': 'XMLHttpRequest',
			'Sec-Fetch-Site': 'same-origin',
			'Sec-Fetch-Mode': 'cors',
			'Sec-Fetch-Dest': 'empty',
		},
	});

	/* debug helper – see body on failure while you’re tuning headers */
	if (!res.ok) {
		console.error(await res.text());
		throw new Error(`MSI API error ${res.status}`);
	}

	const json = await res.json();
	return json.result.downloads['AMI BIOS'];
}

/* ── sendDiscord now takes an array of IDs (may be empty) ─────────────── */
async function sendDiscord(webhookUrl, bios, mentionIds = []) {
	// build the “@mentions …” prefix only if we have IDs
	const mentionsText = mentionIds.map((id) => `<@${id}>`).join(' ');
	const messageContent =
		`${mentionsText} [AUTOMATED] BIOS UPDATE AVAILABLE -> ${bios.download_version}!`.trim();

	const embed = {
		title: 'New BIOS Released',
		description: bios.download_description.replace(/\n/g, '\n'),
		url: bios.download_url,
		color: 0xff0000,
		fields: [
			{ name: 'Release date', value: bios.download_release, inline: true },
			{ name: 'File', value: bios.download_file, inline: true },
		],
	};

	await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			content: messageContent,
			embeds: [embed],
			allowed_mentions: { users: mentionIds },
		}),
	});
}

/* -------------------------------------------------------------------------- */
// helper: return the most recent item in an array
const newestOf = (arr) =>
	arr.reduce((a, b) => (new Date(a.download_release) > new Date(b.download_release) ? a : b));

/* -------------------------------------------------------------------------- */

async function main() {
	const cfg = await loadConfig();
	const lastSeen = new Date(cfg.last_bios_release);
	const biosList = await fetchBiosList();

	// keep only releases after the one we already handled
	const newer = biosList.filter((b) => new Date(b.download_release) > lastSeen);
	if (!newer.length) {
		console.log('✅ Nothing new.');
		return;
	}

	// --- alert just once, for the newest of those releases -------------------
	const latest = newestOf(newer);
	await sendDiscord(cfg.webhook_url, latest, cfg.mention_user_ids);
	console.log(`Sent Discord alert for ${latest.download_version}`);

	// --- store that date so we won’t re-alert next run -----------------------
	cfg.last_bios_release = latest.download_release;
	await saveConfig(cfg);
	console.log(`🔄 Config updated → ${latest.download_release}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
