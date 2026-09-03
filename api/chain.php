<?php
/**
 * chain.php — the one place the server knows what token and what chain.
 *
 * These five facts were repeated across six files, which meant pointing the
 * site at a different token or a different chain involved finding all six and
 * hoping. The browser has had a single source of truth in assets/js/config.js
 * since the beginning; this is the same idea for the server.
 *
 * RELAUNCHING WITH A DIFFERENT TOKEN: change the values here and the matching
 * ones in assets/js/config.js, and the whole back end follows. See the
 * "Relaunching this for another token" section of the README for the rest.
 *
 * Every value can be overridden by an environment variable, which is how the
 * tests point the same code at a mock chain.
 */

declare(strict_types=1);

/** Read a setting from the environment, or fall back to the value here. */
function chainCfg(string $key, string $default): string {
    $v = getenv($key);
    return ($v === false || $v === '') ? $default : $v;
}

/* ── the token this site is about ───────────────────────────────────────── */
define('ROBIN_TOKEN',    chainCfg('ROBIN_TOKEN', '0x280413fbF06CcC1114094A5967dB2191d49EE75e'));
define('ROBIN_DECIMALS', (int)chainCfg('ROBIN_DECIMALS', '18'));

/* ── the chain it lives on ──────────────────────────────────────────────── */
define('ROBIN_CHAIN_ID', (int)chainCfg('ROBIN_CHAIN_ID', '4663'));
define('ROBIN_RPC',      chainCfg('ROBIN_RPC', 'https://rpc.mainnet.chain.robinhood.com'));

/* ── where the numbers come from ────────────────────────────────────────── */
/* SCAN_EXPLORER and SCAN_DS keep their original names: the test suite already
   sets them, and renaming them would break every mock for no gain. */
define('ROBIN_EXPLORER', chainCfg('SCAN_EXPLORER', 'https://robinhoodchain.blockscout.com/api/v2'));
define('ROBIN_DEX',      chainCfg('SCAN_DS', 'https://api.dexscreener.com/latest/dex'));
