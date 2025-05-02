// ==UserScript==
// @name			Lestrade's Prices
// @namespace		https://lestrades.com
// @version			0.85.3
// @description 	Integrates GG.Deals prices on Lestrades.com with caching, rate limiting and one-click price lookups.
// @match			https://lestrades.com/*
// @connect			gg.deals
// @grant			GM_xmlhttpRequest
// @grant			GM_setValue
// @grant			GM_getValue
// @grant			GM_registerMenuCommand
// @grant			GM_addStyle
// @run-at			document-end
// @homepageURL		https://github.com/Nao/Lestrades-Prices/
// @supportURL		https://lestrades.com/general/358/script-help-retrieve-gg-deals-prices/
// @downloadURL		https://github.com/Nao/Lestrades-Prices/raw/refs/heads/main/Lestrades-Prices.user.js
// @updateURL		https://github.com/Nao/Lestrades-Prices/raw/refs/heads/main/Lestrades-Prices.user.js
// ==/UserScript==

// Original author: MrAwesomeFalcon
// Fiddled with by: Nao

(function() {
	'use strict';

	// CONFIG
	const AUTO_CHECK_COUNT = 0; // number of prices to automatically check every page load. CAREFUL this will almost certainly rate limit you immediately.
	const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // one week
	const SHOW_CACHED_IMMEDIATELY = true; // load items from the cache
	const ITEMS_PER_PAGE = 50; // items per page in the cache view
	const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
	const GAME_NAME_WIDTH = 70; // width of game names for making cache view look nicer
	const ICON_URL = 'https://i.imgur.com/s4oAJ1k.png'; // url used for the button icon. https://imgur.com/a/dTvpB2K for more icons made by Falc
	const PRICE_NOLD = 'No LD';
	const PRICE_EMPTY = 'Empty';
	const PRICE_ERROR = 'Error';
	const PRICE_TIMEOUT = 'Timeout';

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
		if (requestQueue.length) GM_xmlhttpRequest(requestQueue.shift());
		setTimeout(execRequest, REQUEST_INTERVAL_MS + Math.floor(Math.random() * 300));
	}

	function queueGMRequest(req) { requestQueue.push(req); }

	function link_me(btnId, link, text)
	{
		const btn = document.getElementById(btnId + '_after');
		if (btn) btn.innerHTML = ' (<a href="' + link + '" target="_blank" style="text-decoration:none;">' + ((text + '').indexOf('|') >= 0 ? (text.split('|')[0] + ' ' + text.split('|')[1] / 100) : text) + '</a>)';
	}

	// -------------------------------------------------------------------------
	// 1) Scanning for app IDs across Lestrade's
	// -------------------------------------------------------------------------
	function scanLestrades() {
		const gameLinks = document.querySelectorAll('a[data-appid], a[data-subid]');
		gameLinks.forEach((link) => {
			if (link.id == 'gg-priority') return; // We're doing this silently below.
			const gameName = link.innerText || document.title;
			const btnId = `ggdeals_btn_${Math.random().toString(36).substr(2,9)}`;
			let appId = link.getAttribute('data-appid') ? 'app/' + link.getAttribute('data-appid') : 'sub/' + link.getAttribute('data-subid');
				appId += link.getAttribute('data-store') ? '|' + link.getAttribute('data-store') : '';
			link.removeAttribute('data-appid');
			link.removeAttribute('data-subid');

			const container = document.createElement('span');
			container.classList.add('ggdeals-price-container');
			container.innerHTML = `
				<a id="${btnId}" class="gg-btn">
					<img src="${ICON_URL}" title="GG.Deals: Click to load/update price info!">
				</a>
				<small id="${btnId}_after"></small>`;
			link.insertAdjacentElement('afterend', container);

			appItems.push({ appId, btnId, gameName });

			// Always refetch on click
			const btnElem = document.getElementById(btnId);
			btnElem.addEventListener('click', async () => {
				window.unsafeWindow._ignor_clic = true;
				await fetchItemPrice(appId, btnId, gameName);
			});

			// Show cached if fresh or mark as needed
			const cached = cachedPrices[appId];
			if (SHOW_CACHED_IMMEDIATELY && cached && isCacheFresh(cached.timestamp)) {
				link_me(btnId, gg_URL(appId), cached.price);
			} else if (!cached) {
				freshApps.push({ btnId, appId: appId });
			} else if (!isCacheFresh(cached.timestamp)) {
				freshApps.push({ btnId, appId: appId });
			}
		});

		// Auto-fetch the single priority entry on any page -- but only after 5 seconds, to avoid overloading the server.
		// Note that the website only asks for Steam apps (and not packages), to save time and sanity.
		if (document.querySelector('#gg-priority')) {
            setTimeout(() => {
				fetchItemPrice('app/' + document.querySelector('#gg-priority').getAttribute('data-appid'));
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
				filteredEntries = allEntries.filter(e => e.gameName.toLowerCase().includes(query) || (e.appid && e.appid.toString().includes(query))
				);
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
			if (!SHOW_CACHED_IMMEDIATELY || !cached || !isCacheFresh(cached.timestamp) || [PRICE_ERROR, PRICE_TIMEOUT, PRICE_EMPTY, PRICE_NOLD].includes(cached.price)) {
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
				data: 'gg=' + encodeURI(priceInfo) + '&url=' + encodeURI(gameURL) + '&app=' + encodeURI(appId) + '&' + window.unsafeWindow.we_sessvar + '=' + window.unsafeWindow.we_sessid,
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
			});
		}
		if (btnId) link_me(btnId, gg_URL(appId), priceInfo);
	}

	async function GM_fetch_html(request) {
		const response = await new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method  : 'POST',
				headers : { 'X-Requested-With': 'XMLHttpRequest', 'Content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
				url     : request.url,
				data    : request.data,
				onload  : resolve,
				onerror : reject
			});
		});
		if (response.status !== 200) throw `Invalid status: ${response.status}`;
		return new DOMParser().parseFromString(response.responseText || '', 'text/html');
	}

	async function getPricesFromChunk(url, drm, csrf)
	{
		const doc = await GM_fetch_html({
			url: `https://gg.deals${url}`,
			data: `gg_csrf=${csrf}`
		});
		return doc.querySelectorAll(`.similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text)`);
	}

	// Get currency + lowest price among all official & keyshop entries with a Steam DRM.
	async function getPricesFromDOM(doc, drm)
	{
		drm = drm || 'steam';
		const ld = doc.querySelector('script[type="application/ld+json"]');
		if (!ld) return PRICE_NOLD; // Likely no prices available!
		let csrf = doc.querySelector('[name="csrf-token"]')?.getAttribute('content');
		let p1 = doc.querySelectorAll(`#official-stores .similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text)`);
		let p2 = doc.querySelectorAll(`#keyshops .similar-deals-container:has(svg.svg-drm-${drm}) :is(.price-inner, .price-text)`);
		try {
			if (!p1.length && doc.querySelector('#official-stores')) p1 = await getPricesFromChunk(doc.querySelector('#official-stores button.btn-show-more')?.getAttribute('data-url'), drm, csrf);
			if (!p2.length && doc.querySelector('#keyshops')) p2 = await getPricesFromChunk(doc.querySelector('#keyshops button.btn-show-more')?.getAttribute('data-url'), drm, csrf);
		}
		catch (e) {
			console.log(e.error);
		}
		// GG prices always have 2 decimal digits, so just remove all non-digit chars, giving us a price in cents, and keep the smallest result!
		const price = Math.min(...Array.from(Array.from(p1).concat(Array.from(p2))).map(el => el.textContent.replace(/[^\d]/g, '')));
		if (/\d+/.test(price)) return (JSON.parse(ld.innerText)?.offers?.priceCurrency || 'LTS') + '|' + price;
		return PRICE_EMPTY;
	}

	// -------------------------------------------------------------------------
	// Fetch logic (always fresh on manual click)
	// -------------------------------------------------------------------------
	async function fetchItemPrice(appId, btnId, gameName)
	{
        const my_short_url = (r) => (r.finalUrl || '').replace(/.*\/game\//, '').replace(/\/$/, '');

		queueGMRequest({
			method: 'GET',
			url: gg_URL(appId),
			onload: async (response) => {
				let price, gameTitle;
				if (response.status >= 400) price = response.status;
				else {
					const parser = new DOMParser();
					const doc = parser.parseFromString(response.responseText, 'text/html');
					price = await getPricesFromDOM(doc, appId.split('|')[1] || 'steam');
					let nameElem = doc.querySelector('a[itemprop="item"].active span[itemprop="name"]');
					gameTitle = nameElem ? nameElem.textContent.trim() : gameName;
				}

				storeInCache(appId, price, gameTitle, btnId, my_short_url(response));
			},
			onerror: (response) => storeInCache(appId, PRICE_ERROR, gameName, btnId, my_short_url(response)),
			ontimeout: (response) => storeInCache(appId, PRICE_TIMEOUT, gameName, btnId, my_short_url(response))
		});
	}

	// -------------------------------------------------------------------------
	// URL helper
	// -------------------------------------------------------------------------
	function gg_URL(appId) {
		return `https://gg.deals/steam/${appId.split('|')[0]}/?region=us`;
	}

	// -------------------------------------------------------------------------
	// Freshness / pruning
	// -------------------------------------------------------------------------
	function isCacheFresh(timestamp) {
		return (Date.now() - timestamp) < CACHE_DURATION;
	}

	function pruneOldEntries()
	{
		const now = Date.now();
		let changed = false;
		for (const [key, data] of Object.entries(cachedPrices)) {
			if ((now - data.timestamp) > MONTH_MS) {
				delete cachedPrices[key];
				changed = true;
			}
		}
		if (changed) {
			GM_setValue('cachedPrices', cachedPrices);
		}
	}

	function formatAge(ms)
	{
		const ageInDays = ms / (1000*60*60*24);
		const ageInHours = ageInDays * 24;
		const ageInMinutes = ageInHours * 60;

		if (ageInHours < 1) {
			return `${ageInMinutes.toFixed(2)} minutes`;
		} else if (ageInHours < 24) {
			return `${ageInHours.toFixed(2)} hours`;
		}
		return `${ageInDays.toFixed(2)} days`;
	}
})();
