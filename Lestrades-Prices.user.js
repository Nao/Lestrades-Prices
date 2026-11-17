// ==UserScript==
// @name			Lestrade's Prices
// @namespace		https://lestrades.com
// @version			1.10
// @description 	Integrates GG.Deals prices on Lestrades.com with caching, rate limiting and one-click price lookups.
// @match			https://lestrades.com/*
// @match			https://gg.deals/*
// @connect			gg.deals
// @grant			GM_xmlhttpRequest
// @grant			GM_setValue
// @grant			GM_getValue
// @grant			GM_registerMenuCommand
// @grant			GM_addStyle
// @grant			GM_openInTab
// @grant			GM_addValueChangeListener
// @grant			GM_deleteValue
// @grant			unsafeWindow
// @run-at			document-end
// @homepageURL		https://github.com/Nao/Lestrades-Prices/
// @supportURL		https://lestrades.com/general/358/script-help-retrieve-gg-deals-prices/
// @downloadURL		https://github.com/Nao/Lestrades-Prices/raw/refs/heads/main/Lestrades-Prices.user.js
// @updateURL		https://github.com/Nao/Lestrades-Prices/raw/refs/heads/main/Lestrades-Prices.user.js
// ==/UserScript==

// Authors: Nao, MrAwesomeFalcon, Raggart

(function() {
	'use strict';

	// Price states (also used by the relay tab, so declared first)
	const PRICE_NOLD = 'No LD';
	const PRICE_EMPTY = 'Empty';
	const PRICE_ERROR = 'Error';
	const PRICE_TIMEOUT = 'Timeout';
	const PRICE_CF = 'CF';
	const PRICE_RELAY = 'Relay';

	// On gg.deals, only the dedicated relay tab does anything; normal browsing is untouched.
	const RELAY_HASH = '#lestrades-relay';
	if (location.hostname === 'gg.deals') {
		if (location.hash === RELAY_HASH)
			runRelayWorker();
		return;
	}

	// CONFIG
	const AUTO_CHECK_COUNT = 0; // number of prices to automatically check every page load. CAREFUL this will almost certainly rate limit you immediately.
	const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // one week
	const SHOW_CACHED_IMMEDIATELY = true; // load items from the cache
	const ITEMS_PER_PAGE = 50; // items per page in the cache view
	const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
	const GAME_NAME_WIDTH = 70; // width of game names for making cache view look nicer
	const ICON_URL = 'R0lGODlhEAAQALMAAAAQGACU3hBS/2tze3N7e4R71pScnL3GxsZznNbe3t7e3u8YMe/v7////////wCS2yH5BAEAAA8ALAAAAAAQABAAAARM8MlJq704W8ApBxUwKAP4iKR5Kg2jgADrmkDTGF3N4N3ZHBzeL5gb1hoLBPBYOuIMjYLgBoC+TglbI8Fh2bgTVEkiVpF7Z7NmzW4/IgA7';

	// REQUEST QUEUE TO LIMIT RATE (10 requests/minute as requested by gg.deals => 1 request/6 seconds)
	const REQUEST_INTERVAL_MS = 6000;
	let requestQueue = [];
	setTimeout(execRequest, 1000); // Do it a first time once we have a chance to fill in that queue.

	GM_addStyle(`
		.ggdeals-price-container {
			display: inline-block !important;
			position: relative;
			margin: 0 0 0 3px;
			top: 3px;
		}
		.ggdeals-price-container * {
			line-height: 1 !important;
		}
		.ggdeals-price-container small {
			position: relative;
			top: -3px;
		}`);

	let cachedPrices = GM_getValue('cachedPrices', {});
	if (typeof cachedPrices !== 'object' || cachedPrices === null) {
		cachedPrices = {};
	}

	pruneOldEntries();

	GM_registerMenuCommand('View Cached Prices', viewCachedPrices);
	GM_registerMenuCommand('Clear Cached Prices', clearCachedPrices);
	GM_registerMenuCommand('Soft load (only missing)', softLoad);
	GM_registerMenuCommand('Hard load (refresh all)', hardLoad);

	let appItems = [];
	let freshApps = [];

	window.addEventListener('load', init);

	function init() {
		// 1) Normal /game/ links scanning
		scanLestrades();

		// 2) Auto-load if desired
		maybeAutoLoadFresh();
	}

	function execRequest() {
		if (requestQueue.length) {
			const job = requestQueue.shift();
			if (typeof job === 'function')
				job();
			else
				GM_xmlhttpRequest(job);
		}
		setTimeout(execRequest, REQUEST_INTERVAL_MS + Math.floor(Math.random() * 300));
	}

	function queueGMRequest(req) { requestQueue.push(req); }

	function link_me(btnId, link, text) {
		const btn = document.getElementById(btnId + '_after');
		if (btn) btn.innerHTML = ' (<a href="' + link + '" target="_blank" style="text-decoration:none;">' + ((text + '').indexOf('|') >= 0 ? (text.split('|')[0] + ' ' + text.split('|')[1] / 100) : text) + '</a>)';
	}

	// -------------------------------------------------------------------------
	// 1) Scanning for app IDs across Lestrade's
	// -------------------------------------------------------------------------
	function scanLestrades() {
		if ((document.URL.match(/\/(matches|library|blacklist)\b/g)) && !document.URL.match(/[?&;]gg/g)) return;
		const gameLinks = document.querySelectorAll('a[data-appid], a[data-subid], a[data-ggu]');
		if (gameLinks.length > 200 && !document.URL.match(/[?&;]gg/g)) return;
		gameLinks.forEach(async (link) => {
			if (link.id == 'gg-priority') return; // We're doing this silently below.
			const gameName = link.innerText || document.title;
			const btnId = `ggdeals_btn_${Math.random().toString(36).substr(2,9)}`;
			const ggu = link.getAttribute('data-ggu') || '';
			let appId = link.getAttribute('data-appid') ? 'app/' + link.getAttribute('data-appid') : (link.getAttribute('data-subid') ? 'sub/' + link.getAttribute('data-subid') : (ggu.includes('/') ? ggu : 'game/' + ggu));
				appId += link.getAttribute('data-store') ? '|' + link.getAttribute('data-store') : '';
			link.removeAttribute('data-appid');
			link.removeAttribute('data-subid');
			link.removeAttribute('data-ggu');

			const container = document.createElement('span');
			container.classList.add('ggdeals-price-container');
			container.innerHTML = `
				<a id="${btnId}" class="gg-btn">
					<img src="data:image/gif;base64,${ICON_URL}" title="GG.Deals: Click to load/update price info!">
				</a>
				<small id="${btnId}_after"></small>`;
			link.insertAdjacentElement('afterend', container);

			appItems.push({ appId, btnId, gameName });

			// Always refetch on click
			const btnElem = document.getElementById(btnId);
			btnElem.addEventListener('click', async () => {
				(window.unsafeWindow || unsafeWindow || window)._ignor_clic = true;
				await fetchItemPrice(appId, btnId, gameName);
			});

			// Show cached if fresh or mark as needed
			const cached = cachedPrices[appId];
			if (SHOW_CACHED_IMMEDIATELY && cached && isCacheFresh(cached.timestamp))
				link_me(btnId, gg_URL(appId), cached.price);
			else if (!cached)
				freshApps.push({ btnId, appId: appId });
			else if (!isCacheFresh(cached.timestamp))
				freshApps.push({ btnId, appId: appId });
		});

		// Auto-fetch the single priority entry on any page -- but only after 5 seconds, to avoid overloading the server.
		// Note that the website only asks for Steam apps (and not packages), to save time and sanity.
		if (document.querySelector('#gg-priority')) {
			setTimeout(() => {
				const ggu = document.querySelector('#gg-priority').getAttribute('data-ggu');
				fetchItemPrice(ggu ? (ggu.includes('/') ? ggu : 'game/' + ggu) : 'app/' + document.querySelector('#gg-priority').getAttribute('data-appid'));
			}, 5000);
		}
	}

	// -------------------------------------------------------------------------
	// 2) Auto-load logic
	// -------------------------------------------------------------------------
	function maybeAutoLoadFresh() {
		// Autoload fresh items
		if (AUTO_CHECK_COUNT > 0 && freshApps.length > 0) {
			const limit = Math.min(AUTO_CHECK_COUNT, freshApps.length);
			for (let i = 0; i < limit; i++) {
				setTimeout(() => {
					const elem = document.getElementById(freshApps[i].btnId);
					if (elem) elem.click();
				}, 500 * i);
			}
		}
	}

	// -------------------------------------------------------------------------
	// Menu commands: cache view, soft/hard load, etc.
	// -------------------------------------------------------------------------
	function viewCachedPrices() {
		const now = Date.now();
		const allEntries = Object.entries(cachedPrices).map(([key, data]) => {
			return {
				gameName: data.name || key,
				price: data.price,
				ageStr: formatAge(now - data.timestamp),
				url: gg_URL(data.appid),
				appid: data.appid || key
			};
		});

		// Sort by gameName alphabetically
		allEntries.sort((a, b) => a.gameName.localeCompare(b.gameName));
		showPagedPopup(allEntries);
	}

	function showPagedPopup(allEntries) {
		let currentPage = 0;
		let filteredEntries = [...allEntries];
		const totalPages = () => Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);

		const overlay = document.createElement('div');
		overlay.style = `
			position: fixed; top:0; left:0; width:100%; height:100%;
			background-color: rgba(0,0,0,0.7); z-index:999999; display:flex;
			align-items:center; justify-content:center;
		`;

		const popup = document.createElement('div');
		popup.style = `
			background:#333; color:#fff; padding:20px; border-radius:8px; width:80%;
			max-height:80%; overflow-y:auto; box-sizing:border-box; position:relative;
			font-family: monospace;
		`;

		const closeXButton = document.createElement('button');
		closeXButton.textContent = '✖';
		closeXButton.style = `
			position:absolute; top:10px; right:10px; background:transparent; color:#fff;
			border:none; font-size:20px; cursor:pointer;
		`;
		closeXButton.addEventListener('click', () => document.body.removeChild(overlay));
		popup.appendChild(closeXButton);

		const h1 = document.createElement('h1');
		h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
		h1.style.marginTop = '0';
		h1.style.paddingRight = '30px';
		popup.appendChild(h1);

		// Search bar
		const searchDiv = document.createElement('div');
		searchDiv.style.marginBottom = '10px';
		const searchInput = document.createElement('input');
		searchInput.type = 'text';
		searchInput.placeholder = 'Search game name or appid...';
		searchInput.style.marginRight = '5px';

		const searchButton = document.createElement('button');
		searchButton.textContent = 'Search';
		searchButton.style.marginRight = '5px';

		const clearButton = document.createElement('button');
		clearButton.textContent = 'Reset';

		searchButton.addEventListener('click', () => {
			const query = searchInput.value.trim().toLowerCase();
			if (query) {
				filteredEntries = allEntries.filter(e => e.gameName.toLowerCase().includes(query) || (e.appid && e.appid.toString().includes(query)));
			} else {
				filteredEntries = [...allEntries];
			}
			currentPage = 0;
			renderPage();
			h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
		});

		clearButton.addEventListener('click', () => {
			searchInput.value = '';
			filteredEntries = [...allEntries];
			currentPage = 0;
			renderPage();
			h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
		});

		searchDiv.appendChild(searchInput);
		searchDiv.appendChild(searchButton);
		searchDiv.appendChild(clearButton);
		popup.appendChild(searchDiv);

		const resultsDiv = document.createElement('div');
		popup.appendChild(resultsDiv);

		const paginationDiv = document.createElement('div');
		paginationDiv.style.marginTop = '10px';

		const prevButton = document.createElement('button');
		prevButton.textContent = 'Previous';
		prevButton.style.marginRight = '5px';

		const nextButton = document.createElement('button');
		nextButton.textContent = 'Next';

		prevButton.addEventListener('click', () => {
			if (currentPage > 0) {
				currentPage--;
				renderPage();
			}
		});
		nextButton.addEventListener('click', () => {
			if (currentPage < totalPages() - 1) {
				currentPage++;
				renderPage();
			}
		});

		paginationDiv.appendChild(prevButton);
		paginationDiv.appendChild(nextButton);
		popup.appendChild(paginationDiv);

		const closeButton = document.createElement('button');
		closeButton.textContent = 'Close';
		closeButton.style = `
			margin-top:10px; background:#555; color:#fff; border:none;
			padding:5px 10px; cursor:pointer;
		`;
		closeButton.addEventListener('click', () => {
			document.body.removeChild(overlay);
		});
		popup.appendChild(closeButton);

		overlay.appendChild(popup);
		document.body.appendChild(overlay);

		function renderPage() {
			resultsDiv.innerHTML = '';
			const start = currentPage * ITEMS_PER_PAGE;
			const end = start + ITEMS_PER_PAGE;
			const pageItems = filteredEntries.slice(start, end);
			if (!pageItems.length) {
				resultsDiv.innerHTML = 'No results.';
				return;
			}

			const lines = pageItems.map(e => formatLine(e.gameName, e.price, e.ageStr, e.url, e.appid));
			resultsDiv.innerHTML = `<pre>${lines.join('\n')}</pre>`;
		}

		renderPage();
	}

	function formatLine(gameName, price, ageStr, url, appid) {
		let fullName = padRight(gameName, GAME_NAME_WIDTH);
		// Reserve space for AppID block: 9 chars "[1230530]" or "[	   ]"
		fullName += appid ? ` [${appid}]` : ` [	   ]`;

		return `${fullName} ${price} (Age: ${ageStr}) <a href="${url}" target="_blank">GG Deals</a>`;
	}

	function padRight(str, length) {
		return (str.length < length) ? str + ' '.repeat(length - str.length) : str;
	}

	function clearCachedPrices() {
		if (confirm('Are you sure you want to clear the price cache?')) {
			cachedPrices = {};
			GM_setValue('cachedPrices', cachedPrices);
			alert('Price cache cleared.');
		}
	}

	function softLoad() {
		appItems.forEach(item => {
			const { appId, btnId } = item;
			const cached = cachedPrices[appId];
			if (!SHOW_CACHED_IMMEDIATELY || !cached || !isCacheFresh(cached.timestamp) || [PRICE_ERROR, PRICE_TIMEOUT, PRICE_EMPTY, PRICE_NOLD, PRICE_CF, PRICE_RELAY].includes(cached.price)) {
				const elem = document.getElementById(btnId);
				if (elem) elem.click();
			}
		});
	}

	function hardLoad() {
		appItems.forEach(async item => {
			const { appId, btnId, gameName } = item;
			await fetchItemPrice(appId, btnId, gameName);
		});
	}

	// -------------------------------------------------------------------------
	// Storing in cache
	// -------------------------------------------------------------------------
	function storeInCache(appId, priceInfo, gameTitle, btnId, gameURL) {
		cachedPrices[appId] = {
			price: priceInfo,
			name: gameTitle || appId,
			appid: appId,
			timestamp: Date.now()
		};
		GM_setValue('cachedPrices', cachedPrices);
		if (document.querySelector('#wedge'))
		{
			GM_xmlhttpRequest({
				method: 'POST',
				url: 'https://lestrades.com/?action=ajax;sa=gg',
				data: 'gg=' + encodeURI(priceInfo) + (appId.includes(gameURL) ? '' : '&url=' + encodeURI(gameURL)) + '&app=' + encodeURI(appId) + '&' + (window.unsafeWindow || unsafeWindow || window).we_sessvar + '=' + (window.unsafeWindow || unsafeWindow || window).we_sessid,
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
			});
		}
		if (btnId) link_me(btnId, gg_URL(appId), priceInfo);
	}

	// Runs in the relay tab, so it fetches directly with same-origin, bypassing restrictions.
	async function GM_fetch_html(request) {
		const response = await pageFetch(request.url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
		if (response.status != 200) throw `Invalid status: ${response.status}`;
		return new DOMParser().parseFromString(String(await response.text()), 'text/html');
	}

	async function getPricesFromChunk(url, drm, csrf) {
		const doc = await GM_fetch_html({ url: `https://gg.deals${url}`	});
		return doc.querySelectorAll(`.similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text, .price)`);
	}

	// Get currency + lowest price among all official & keyshop entries with a Steam DRM.
	async function getPricesFromDOM(doc, drm, txt) {
		drm = drm || 'steam';
		const currency = txt.match('"priceCurrency":"([^"]+)"');
		if (!currency) return PRICE_NOLD; // Likely no prices available!
		let csrfToken = doc.querySelector('[name="csrf-token"]')?.getAttribute('content'), showMoreUrl = '';
		let officialPrices = doc.querySelectorAll(`#official-stores .similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text, .price)`);
		let keyshopPrices = doc.querySelectorAll(`#keyshops .similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text, .price)`);
		try {
			if (!officialPrices.length && doc.querySelector('#official-stores') && (showMoreUrl = doc.querySelector('#official-stores button.btn-show-more')?.getAttribute('data-url')))
				officialPrices = await getPricesFromChunk(showMoreUrl, drm, csrfToken);
			if (!keyshopPrices.length && doc.querySelector('#keyshops') && (showMoreUrl = doc.querySelector('#keyshops button.btn-show-more')?.getAttribute('data-url')))
				keyshopPrices = await getPricesFromChunk(showMoreUrl, drm, csrfToken);
		}
		catch (e) {
			console.log(e.error, showMoreUrl);
		}
		// GG prices always have 2 decimal digits, so just remove all non-digit chars, giving us a price in cents, and keep the smallest result!
		const price = Math.min(...Array.from(Array.from(officialPrices).concat(Array.from(keyshopPrices))).map(priceElement => priceElement.textContent.replace(/[^\d]/g, '')));
		if (/\d+/.test(price)) return (currency[1] || 'LTS') + '|' + price;
		return PRICE_EMPTY;
	}

	// -------------------------------------------------------------------------
	// Fetch logic (always fresh on manual click)
	// -------------------------------------------------------------------------
	async function fetchItemPrice(appId, btnId, gameName) {
		const my_short_url = (r) => String(r.finalUrl).replace(/.*gg\.deals\/(us\/|steam\/)*/g, '').replace(/\/$/, '');

		queueGMRequest(async () => {
			let response;
			try {
				response = await relayRequest(gg_URL(appId), appId.split('|')[1] || 'steam');
			} catch (error) {
				return storeInCache(appId, error === 'timeout' ? PRICE_TIMEOUT : PRICE_RELAY, gameName, btnId, '');
			}
			let price = response.price;
			if (response.status === PRICE_CF) price = PRICE_CF;
			else if (!response.status || response.status >= 400) price = response.status || PRICE_ERROR;
			storeInCache(appId, price, response.title || gameName, btnId, my_short_url(response));
		});
	}

	// Relay: requests are run by a real gg.deals tab (same-origin fetch), so that they should carry the Cloudflare clearance cookie along with normal browser headers.
	// The relay tab fetches AND parses the page, and only sends back the price instead of the whole HTML going through the script storage.
	// Each Lestrade's tab gets its own reply slot, so several open tabs don't overwrite each other. The relay acknowledges each request; unacknowledged requests are re-sent.
	const RELAY_ALIVE_MS = 90000;	// background tabs may only tick once a minute
	const RELAY_ACK_MS = 5000;		// re-send a request not acknowledged within this delay
	const RELAY_MAX_SENDS = 3;		// after that, consider the relay tab gone
	const RELAY_TIMEOUT_MS = 90000;	// 30s for the page + up to two "show more" chunks. Should be more than necessary.
	const RELAY_TAB = Math.random().toString(36).slice(2);
	const RELAY_RES_KEY = 'ggRelayRes_' + RELAY_TAB;
	const relayWaiters = {};
	let relayOpenedAt = 0, relayChain = Promise.resolve();

	GM_addValueChangeListener(RELAY_RES_KEY, (name, oldVal, response) => {
		if (response && relayWaiters[response.id]) relayWaiters[response.id](response);
	});
	window.addEventListener('pagehide', () => GM_deleteValue(RELAY_RES_KEY));

	const relayAlive = () => Date.now() - GM_getValue('ggRelayAlive', 0) < RELAY_ALIVE_MS;

	function ensureRelayTab() {
		if (relayAlive()) return Promise.resolve();
		if (Date.now() - relayOpenedAt > 60000) {
			relayOpenedAt = Date.now();
			GM_openInTab('https://gg.deals/us/' + RELAY_HASH, { active: false, insert: true, setParent: true });
		}
		return new Promise((resolve, reject) => {
			const waitStart = Date.now();
			const aliveCheckTimer = setInterval(() => {
				if (relayAlive()) { clearInterval(aliveCheckTimer); resolve(); }
				else if (Date.now() - waitStart > 45000) { clearInterval(aliveCheckTimer); reject('relay'); }
			}, 1000);
		});
	}

	function relayRequest(url, drm) {
		const run = async () => {
			await ensureRelayTab();
			const id = Date.now() + '_' + Math.random().toString(36).slice(2);
			return new Promise((resolve, reject) => {
				let acked = false, sends = 0;
				const send = () => GM_setValue('ggRelayReq', { id, tab: RELAY_TAB, url, drm, n: ++sends });
				const finish = (settle, value) => { clearInterval(retryTimer); clearTimeout(hardTimeout); delete relayWaiters[id]; settle(value); };
				relayWaiters[id] = (response) => { if (response.ack) acked = true; else finish(resolve, response); };
				const retryTimer = setInterval(() => {
					if (acked) return;
					if (sends < RELAY_MAX_SENDS) return send();
					GM_setValue('ggRelayAlive', 0); // nobody answers: reopen the relay tab next time
					finish(reject, 'relay');
				}, RELAY_ACK_MS);
				const hardTimeout = setTimeout(() => finish(reject, 'timeout'), RELAY_TIMEOUT_MS);
				send();
			});
		};
		// One request at a time per Lestrades tab.
		const pendingRequest = relayChain.then(run, run);
		relayChain = pendingRequest.catch(() => {});
		return pendingRequest;
	}

	function runRelayWorker() {
		// Cloudflare challenge page: do nothing, the script runs again once the real page loads.
		if (/just a moment/i.test(document.title)) return;
		document.title = "[Lestrade's relay] " + document.title;
		const beat = () => GM_setValue('ggRelayAlive', Date.now());
		beat();
		setInterval(beat, 5000);

		const jobs = new Map(); // id -> result (null while running), so re-sent requests aren't fetched twice
		const reply = (req, response) => GM_setValue('ggRelayRes_' + req.tab, Object.assign({ id: req.id, t: Date.now() }, response));

		GM_addValueChangeListener('ggRelayReq', async (name, oldVal, req) => {
			if (!req || !req.id || !req.tab) return;
			if (jobs.has(req.id)) return reply(req, jobs.get(req.id) || { ack: true });
			jobs.set(req.id, null);
			if (jobs.size > 200) jobs.delete(jobs.keys().next().value);
			reply(req, { ack: true });

			let response;
			try {
				const fetchStart = Date.now();
				const fetchResponse = await pageFetch(req.url, { credentials: 'include' });
				const text = String(await fetchResponse.text());
				const status = fetchResponse.status || 0;
				const challenged = String(fetchResponse.headers.get('cf-mitigated')) === 'challenge' || /<title>\s*Just a moment/i.test(text);
				response = { status: challenged ? PRICE_CF : status, finalUrl: String(fetchResponse.url) };
				if (challenged) setTimeout(() => location.reload(), 500); // re-pass the challenge
				else if (status < 400) {
					const doc = new DOMParser().parseFromString(text, 'text/html');
					response.price = await getPricesFromDOM(doc, req.drm, text);
					const nameElem = doc.querySelector('a[itemprop="item"].active span[itemprop="name"]');
					if (nameElem) response.title = nameElem.textContent.trim();
				}
			} catch (error) {
				console.log("[Lestrade's relay] failed", req.url, error);
				response = { status: 0, finalUrl: req.url };
			}
			console.log("[Lestrade's relay]", req.url, '->', response.status, response.price || '', `(${Date.now() - fetchStart} ms)`);
			jobs.set(req.id, response);
			reply(req, response);
		});
	}

	// Firefox runs a userscript's own fetch() with the extension's identity (different origin/headers, no page cookies), which Cloudflare will of course block.
	// Use the page's fetch instead. Chromium browsers (Brave, Chrome) just use the normal fetch.
	function pageFetch(url, init) {
		try {
			if (typeof content !== 'undefined' && content && typeof content.fetch === 'function')
				return content.fetch(url, init);
		} catch (error) {}
		try {
			const pageWindow = window.unsafeWindow || unsafeWindow || window.wrappedJSObject || window;
			if (pageWindow && pageWindow !== window && typeof cloneInto === 'function')
				return pageWindow.fetch(url, cloneInto(init, pageWindow));
		} catch (error) {}
		return fetch(url, init);
	}

	// -------------------------------------------------------------------------
	// URL helper
	// -------------------------------------------------------------------------
	function gg_URL(appId) {
		const url = appId.split('|')[0];
		if (url.match(/^(app|sub)\/\d+$/g)) return `https://gg.deals/us/steam/${url}/`;
		return `https://gg.deals/us/${url}/`;
	}

	// -------------------------------------------------------------------------
	// Freshness / pruning
	// -------------------------------------------------------------------------
	function isCacheFresh(timestamp) {
		return (Date.now() - timestamp) < CACHE_DURATION;
	}

	function pruneOldEntries() {
		const now = Date.now();
		let changed = false;
		for (const [key, data] of Object.entries(cachedPrices)) {
			if ((now - data.timestamp) > MONTH_MS) {
				delete cachedPrices[key];
				changed = true;
			}
		}
		if (changed)
			GM_setValue('cachedPrices', cachedPrices);
	}

	function formatAge(ms) {
		const ageInDays = ms / (1000*60*60*24);
		const ageInHours = ageInDays * 24;
		const ageInMinutes = ageInHours * 60;

		if (ageInHours < 1)
			return `${ageInMinutes.toFixed(2)} minutes`;
		else if (ageInHours < 24)
			return `${ageInHours.toFixed(2)} hours`;
		return `${ageInDays.toFixed(2)} days`;
	}
})();
